// Format reference: GARbro "Legacy/Ocarina/ImageRED.cs", class `RedFormat` (a fixed 800x600
// bitmap whose pixel stream carries skip markers). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'RE0' plus a zero byte; `0x00304552` as a little endian word. */
const SIGNATURE = Buffer.from([0x52, 0x45, 0x30, 0x00]);
const HEADER_SIZE = 4;
/** GARbro `RedFormat.ReadMetaData` returns constants; the file carries no dimensions. */
const WIDTH = 800;
const HEIGHT = 600;
const BYTES_PER_PIXEL = 4;
const BITS_PER_PIXEL = 32;
const PIXEL_COUNT = WIDTH * HEIGHT;
const SIGNATURE_SIZE = 4;

/**
 * GARbro `RedFormat.Read`: a stream of 32 bit pixels from offset 4 where a zero word means "skip the
 * next byte's worth of pixels", which stay transparent black because the array starts zeroed.
 */
function decodePixels(data: Buffer): Buffer {
	const pixels: Buffer = Buffer.alloc(PIXEL_COUNT * BYTES_PER_PIXEL);
	let source = 0;
	let destination = 0;
	while (destination < PIXEL_COUNT && source < data.length) {
		// The reference peeks a single byte and then reads a word, so a short tail is tolerated here
		// rather than read as a partial word.
		if (source + 4 > data.length) break;
		const word = data.readUInt32LE(source);
		source += 4;
		if (word !== 0) {
			pixels.writeUInt32LE(word, destination * BYTES_PER_PIXEL);
			destination += 1;
			continue;
		}
		if (source >= data.length) break;
		destination += data.readUInt8(source);
		source += 1;
	}
	return pixels;
}

async function readPixels(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < BigInt(SIGNATURE_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, SIGNATURE_SIZE));
		if (!header.equals(SIGNATURE)) return undefined;
		if (source.size === BigInt(SIGNATURE_SIZE))
			return decodePixels(Buffer.alloc(0));
		const data = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		return decodePixels(data);
	} catch {
		return undefined;
	}
}

export const redImageDescriptor: FormatDescriptor = {
	id: "ocarina-red-image",
	name: "Ocarina image format",
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
			source: "Legacy/Ocarina/ImageRED.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const redImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: redImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SIGNATURE_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, SIGNATURE_SIZE));
			// The reference reads no metadata at all, so the signature is the whole gate.
			return header.equals(SIGNATURE);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		if ((await readPixels(source)) === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ocarina RED image");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				metadata: {
					type: "image",
					width: WIDTH,
					height: HEIGHT,
					bitsPerPixel: BITS_PER_PIXEL,
				} as Record<string, unknown>,
			}),
			// A bitmap header is prepended and the pixel area is a fixed size.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const pixels = await readPixels(source);
		if (!pixels)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ocarina RED image");
		return Readable.from([writeBmp32(WIDTH, HEIGHT, pixels)]);
	},
});
