// Format reference: GARbro "ArcFormats/FC01/ImageWM2.cs", class `Wm2Format` (an eight bit mask whose rows are
// patched from a table rather than stored in order). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** `2.0` and a null: the reference's word `0x00302E32`. */
const SIGNATURE = Buffer.from("2.0\0", "latin1");
const HEADER_SIZE = 12;
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
/** The dimensions must be non zero and no wider than this. */
const MAX_DIMENSION = 0x8000;
/** Four words a row, sixteen bytes. */
const TABLE_ROW_SIZE = 16;
const WORDS_PER_ROW = 4;
/** A sane bound on the output, which the reference would try to allocate whatever its size. */
const MAX_PIXELS = 256 * 1024 * 1024;

interface Wm2Layout {
	width: number;
	height: number;
	/** Where the table ends and the pool the row offsets point into begins. */
	dataPosition: number;
}

/**
 * `ReadMetaData` reads twelve bytes and accepts the file when both dimensions are non zero and at most 0x8000.
 * The depth is always eight and the table is read later, so a file truncated inside the table still lists.
 */
async function readLayout(source: ByteSource): Promise<Wm2Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		if (width === 0 || width > MAX_DIMENSION) return undefined;
		if (height === 0 || height > MAX_DIMENSION) return undefined;
		if (width * height > MAX_PIXELS) return undefined;
		return {
			width,
			height,
			dataPosition: HEADER_SIZE + height * TABLE_ROW_SIZE,
		};
	} catch {
		return undefined;
	}
}

export const wm2ImageDescriptor: FormatDescriptor = {
	id: "fc01-wm2-image",
	name: "F&C Co. bitmap mask",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/FC01/ImageWM2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wm2ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wm2ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid F&C WM2 mask");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// A bitmap header is written around the assembled rows.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid F&C WM2 mask");
		const tableSize = layout.height * TABLE_ROW_SIZE;
		if (Number(source.size) < HEADER_SIZE + tableSize)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated F&C WM2 mask");
		const table = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), tableSize),
		);
		// The reference allocates the output with `new byte[width * height]`, so every byte no row patches
		// stays zero.
		const output: Buffer = Buffer.alloc(layout.width * layout.height);
		for (let y = 0; y < layout.height; y += 1) {
			const word = y * WORDS_PER_ROW * 4;
			if (table.readInt32LE(word) === 0) continue;
			// The flag word's value is not used beyond that test; the other three are the offset within the
			// row, the byte count and the offset of the source inside the pool after the table.
			const position = table.readInt32LE(word + 4);
			const count = table.readInt32LE(word + 8);
			const from = table.readInt32LE(word + 12) + layout.dataPosition;
			const start = y * layout.width + position;
			// The reference writes into a flat array, so a row that reaches past the image throws there; the
			// port declines the extraction instead. A source range outside the file simply yields nothing,
			// which is what reading past the end of a stream does.
			if (position < 0 || count < 0 || start + count > output.length)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"F&C WM2 row reaches past the image",
				);
			if (from < 0 || count === 0) continue;
			const available = Math.max(
				0,
				Math.min(count, Number(source.size) - from),
			);
			if (available === 0) continue;
			const chunk = Buffer.from(await source.readAt(BigInt(from), available));
			chunk.copy(output, start);
		}
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp8(layout.width, layout.height, output)]);
	},
});
