// Format reference: GARbro "Legacy/Jam/ImageHTF.cs", class `HtfFormat` (a Huffman compressed bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decompressHuffman } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpMetaData } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 4;
/** The reference accepts an unpacked size in `1..0x1000000` and nothing else. */
const MAX_UNPACKED = 0x1000000;

interface HtfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The length the bitmap header declares, which is what the reference's decoder yields. */
	fileSize: number;
	/** The length the container declares for the whole decompressed stream. */
	unpackedSize: number;
}

/** The reference gates on `.HTF` before reading anything. */
function hasExtension(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "htf";
}

/** `ReadMetaData` reads the unpacked size and then decodes the stream to read the bitmap header. */
async function readLayout(source: ByteSource): Promise<HtfLayout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const unpackedSize = head.readInt32LE(0);
		if (unpackedSize <= 0 || unpackedSize > MAX_UNPACKED) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		const bmp = decompressHuffman(stored, unpackedSize);
		const meta = readBmpMetaData(bmp);
		if (!meta) return undefined;
		return {
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
			fileSize: meta.fileSize,
			unpackedSize,
		};
	} catch {
		return undefined;
	}
}

export const htfImageDescriptor: FormatDescriptor = {
	id: "jam-htf-image",
	name: "Huffman-compressed bitmap",
	extensions: ["htf"],
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
			source: "Legacy/Jam/ImageHTF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const htfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: htfImageDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Jam HTF image");
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Jam HTF image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The stored stream is compressed and the bitmap is trimmed to its declared length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "huffman",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Jam HTF image");
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		let bmp: Buffer;
		try {
			bmp = decompressHuffman(stored, layout.unpackedSize);
		} catch {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Jam HTF image");
		}
		// A bitmap may declare less than the stream holds; the reference reads it by its own length.
		return Readable.from([bmp.subarray(0, layout.fileSize)]);
	},
});
