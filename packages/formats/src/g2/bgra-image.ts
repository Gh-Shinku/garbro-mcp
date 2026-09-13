// Format reference: GARbro "ArcFormats/G2/ImageBGRA.cs", class `BgraFormat` (a raw 32 bit BGRA image).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from([0x42, 0x47, 0x52, 0x41]);
const HEADER_SIZE = 0x10;
/** `ReadMetaData` requires this exact word at offset four; it looks like a set of depth flags. */
const MARKER = 0x08080808;
const MARKER_OFFSET = 4;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const BYTES_PER_PIXEL = 4;

interface BgraLayout {
	width: number;
	height: number;
}

/**
 * `ReadMetaData` seeks to offset four, checks the marker word and reads the dimensions. It does not look at
 * the file length, so a file whose pixel data is short still lists — the reference only notices when `Read`
 * asks for the pixels.
 */
async function readLayout(source: ByteSource): Promise<BgraLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (header.readUInt32LE(MARKER_OFFSET) !== MARKER) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		// The reference would accept a zero sized image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height };
	} catch {
		return undefined;
	}
}

export const bgraImageDescriptor: FormatDescriptor = {
	id: "g2-bgra-image",
	name: "G2 engine image format",
	extensions: ["argb", "arg"],
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
			source: "ArcFormats/G2/ImageBGRA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bgraImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bgraImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid G2 BGRA image");
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
					bitsPerPixel: 32,
				} as Record<string, unknown>,
			}),
			// The pixel data is copied unchanged, but a bitmap header is written around it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid G2 BGRA image");
		const needed = layout.width * BYTES_PER_PIXEL * layout.height;
		const stored = Number(source.size) - HEADER_SIZE;
		// `Read` insists on a full pixel buffer and throws otherwise; that split is faithful, so a short
		// file lists but fails here.
		if (stored < needed)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated G2 BGRA image");
		const pixels = Buffer.from(
			await source.readAt(BigInt(HEADER_SIZE), needed),
		);
		// `ImageData.Create` keeps the stored top down order, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
