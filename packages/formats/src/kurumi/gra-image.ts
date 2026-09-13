// Format reference: GARbro "ArcFormats/Kurumi/ImageGRA.cs", class `GraFormat` (a xor masked, zlib
// compressed bitmap). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
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
} from "../shared/fixed-archive.js";

/** `Virg`, the first four characters of the header text. */
const SIGNATURE = Buffer.from([0x56, 0x69, 0x72, 0x67]);
const HEADER_SIZE = 0x20;
const MAGIC = Buffer.from("Virgin Snow Compressed Data 1.0", "ascii");
/** The two byte key `ByteStringEncryptedStream` repeats over the compressed stream. */
const KEY = [0x5a, 0xa5];
/** The bitmap has no declared unpacked size, so decompression is bounded instead. */
const MAX_OUTPUT = 0x4000000;

interface GraLayout {
	bmp: Buffer;
	width: number;
	height: number;
	bitsPerPixel: number;
}

function unmask(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ (KEY[i % KEY.length] ?? 0);
	return output;
}

/**
 * Reads the header, unmasks the stream that follows it and inflates it. The result is a bitmap, which is
 * trimmed to the size the bitmap itself declares: the compressed stream may carry more than the image, and
 * both sizes have to be followed rather than conflated.
 */
async function readLayout(source: ByteSource): Promise<GraLayout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (!header.subarray(0, MAGIC.length).equals(MAGIC)) return undefined;
		const stored = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		const unpacked = await inflateZlibBufferCapped(unmask(stored), MAX_OUTPUT);
		const meta = readBmpMetaData(unpacked);
		if (!meta) return undefined;
		return {
			bmp: unpacked.subarray(0, meta.fileSize),
			width: meta.width,
			height: meta.height,
			bitsPerPixel: meta.bitsPerPixel,
		};
	} catch {
		return undefined;
	}
}

export const kurumiGraImageDescriptor: FormatDescriptor = {
	id: "kurumi-gra-image",
	name: "Virgin Snow image format",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Kurumi/ImageGRA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kurumiGraImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kurumiGraImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi GRA image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				encrypted: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			// The payload is masked and compressed, so the stored size says nothing about the output.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "zlib",
				encrypted: true,
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi GRA image");
		return Readable.from([layout.bmp]);
	},
});
