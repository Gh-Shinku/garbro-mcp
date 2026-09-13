// Format reference: GARbro "ArcFormats/Ankh/ImageMSK.cs", class `MskFormat` (an LZSS compressed eight bit
// gray mask whose header size is selected by a flag field). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
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

/** `msk` followed by a zero byte, which is what the reference's signature word describes. */
const SIGNATURE = Buffer.from([0x6d, 0x73, 0x6b, 0x00]);
const WIDTH_OFFSET = 4;
const HEIGHT_OFFSET = 8;
/** A non-zero value here puts the stream at offset 12, which overlaps this very field. */
const FLAG_OFFSET = 0x0c;
const SHORT_HEADER = 12;
const LONG_HEADER = 16;
/** Guards against a hostile stream asking for an unreasonable allocation. */
const MAX_OUTPUT = 0x4000000;

interface MskLayout {
	width: number;
	height: number;
	/** Where the LZSS stream starts: the closed header, or the flag field itself. */
	headerSize: number;
}

/**
 * `ReadMetaData` reads sixteen bytes and takes the dimensions and the header size from them without
 * validating anything else. The header size is twelve when the flag field is non-zero and sixteen when it
 * is zero, so a stream can begin *inside* the flag field.
 */
async function readLayout(source: ByteSource): Promise<MskLayout | undefined> {
	if (source.size < BigInt(SHORT_HEADER)) return undefined;
	try {
		const header = Buffer.from(
			await source.readAt(0n, Math.min(LONG_HEADER, Number(source.size))),
		);
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const width = header.readUInt32LE(WIDTH_OFFSET);
		const height = header.readUInt32LE(HEIGHT_OFFSET);
		const flag = header.readInt32LE(FLAG_OFFSET);
		const headerSize = flag !== 0 ? SHORT_HEADER : LONG_HEADER;
		if (BigInt(headerSize) > source.size) return undefined;
		// The reference would decode a zero sized image; nothing can be drawn from one.
		if (width === 0 || height === 0) return undefined;
		return { width, height, headerSize };
	} catch {
		return undefined;
	}
}

/** Decodes the stream at the selected offset, capped because the gray data has no declared length. */
async function readPixels(
	source: ByteSource,
	layout: MskLayout,
): Promise<Buffer | undefined> {
	try {
		const stored = Buffer.from(
			await source.readAt(
				BigInt(layout.headerSize),
				Number(source.size) - layout.headerSize,
			),
		);
		const decoded = Buffer.from(
			inflateLzssAll(stored, { maxOutputLength: MAX_OUTPUT }),
		);
		// The reference reads into a zero filled buffer, so a stream that ends early leaves zeros.
		const pixels = Buffer.alloc(layout.width * layout.height);
		decoded.copy(pixels, 0, 0, Math.min(decoded.length, pixels.length));
		return pixels;
	} catch {
		return undefined;
	}
}

export const ankhMskImageDescriptor: FormatDescriptor = {
	id: "ankh-msk-image",
	name: "Ankh bitmap format",
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
			source: "ArcFormats/Ankh/ImageMSK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ankhMskImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ankhMskImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ankh MSK image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and a bitmap header is written around the output.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				headerSize: layout.headerSize,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ankh MSK image");
		const pixels = await readPixels(source, layout);
		if (!pixels)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ankh MSK image");
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, true),
		]);
	},
});
