// Format reference: GARbro "ArcFormats/Lilim/ImageIMG.cs", classes `BaseImgFormat` and `ImgBmpFormat`
// (Lilim obfuscated bitmap).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readBmpHeaderFields } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Only the first thirty two bytes are obfuscated; the rest of the file is already plain. */
export const OBFUSCATED_PREFIX = 0x20;
export const LILIM_KEY = 0xff;
/**
 * `BM` with the obfuscation applied, which is all the reference checks before it deobfuscates. The Regrips
 * bitmap stores the same two bytes, and neither reference tells the two apart: both deobfuscate the header and
 * read it, so both accept either file. What separates them is where the obfuscation stops, which is a matter of
 * the file, not of the header.
 */
export const IMG_BMP_PREFIX: Buffer = Buffer.from([0xbd, 0xb2]);
/** A bitmap's file header plus the shortest DIB header the shared reader accepts. */
const BMP_MINIMUM_SIZE = 54;

/**
 * Undoes the format's obfuscation: the first thirty two bytes are xored and **everything behind them is left
 * alone**. That is the whole difference from the Regrips format, which xors the entire file, and it is what tells
 * the two apart when they claim the same four stored bytes.
 */
export function deobfuscateLilim(input: Buffer): Buffer {
	const output = Buffer.from(input);
	const end = Math.min(OBFUSCATED_PREFIX, output.length);
	for (let index = 0; index < end; index += 1) {
		output[index] = (output[index] ?? 0) ^ LILIM_KEY;
	}
	return output;
}

export const imgBmpImageDescriptor: FormatDescriptor = {
	id: "lilim-img-bmp-image",
	name: "Lilim obfuscated bitmap",
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
			source: "ArcFormats/Lilim/ImageIMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readFields(source: ByteSource) {
	if (source.size < BigInt(BMP_MINIMUM_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, BMP_MINIMUM_SIZE));
		return readBmpHeaderFields(deobfuscateLilim(head));
	} catch {
		return undefined;
	}
}

export const imgBmpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: imgBmpImageDescriptor,
	detection: { signatures: [{ bytes: IMG_BMP_PREFIX }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const fields = await readFields(source);
		if (!fields)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lilim bitmap");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: {
					type: "image",
					width: fields.width,
					height: fields.height,
					bitsPerPixel: fields.bitsPerPixel,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: fields.width,
				height: fields.height,
				bitsPerPixel: fields.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		if (source.size >= BigInt(Number.MAX_SAFE_INTEGER)) {
			throw new GarbroError("INVALID_ARCHIVE", "Lilim bitmap is too large");
		}
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		const plain = deobfuscateLilim(file);
		if (!readBmpHeaderFields(plain)) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Lilim bitmap");
		}
		// The reference decodes the bitmap; the port hands the deobfuscated original over, which is a bitmap
		// again and keeps its padding.
		return Readable.from([plain]);
	},
});
