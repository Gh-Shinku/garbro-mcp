// Format reference: GARbro "ArcFormats/BlackRainbow/ImageBMD.cs", classes `BmdFormat` and `BmdMetaData`,
// with the walk of `GameRes.Compression.LzssReader` (a Black Rainbow bitmap: four bytes a pixel behind a walk
// of runs whose every byte is a byte of the picture or a pair of bytes pointing behind it). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** '_BMD', the word the reference registers. */
const SIGNATURE = Buffer.from("_BMD", "latin1");
const HEADER_SIZE = 0x14;
const PACKED_SIZE_FIELD = 0x04;
const WIDTH_FIELD = 0x08;
const HEIGHT_FIELD = 0x0c;
const FLAG_FIELD = 0x10;
/** How many bits a pixel takes, which the reference always takes to be thirty two. */
const BITS_PER_PIXEL = 32;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface BmdLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** What the walk of runs holds, which is what the head says. */
	packedSize: number;
	/** Nothing means the fourth byte of a pixel is not a fourth byte at all. */
	flags: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BmdFormat.ReadMetaData`: the file begins with the word `_BMD`, the size of the walk of runs stands at four,
 * the width and the height at eight and `0x0C` as words of four bytes, and a word at `0x10` stands above
 * nought where the fourth byte of a pixel is a fourth byte of a colour. The pixels are of four bytes a pixel
 * whatever that word says.
 */
export function readBmdLayout(
	data: Buffer,
	fileLength = data.length,
): BmdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	if (width > LIMIT || height > LIMIT) return undefined;
	const pixels = width * height * 4;
	if (pixels > LIMIT) return undefined;
	const packedSize = data.readUInt32LE(PACKED_SIZE_FIELD);
	if (HEADER_SIZE + packedSize > fileLength) return undefined;
	return {
		width,
		height,
		bitsPerPixel: BITS_PER_PIXEL,
		packedSize,
		flags: data.readInt32LE(FLAG_FIELD),
	};
}

/**
 * `BmdFormat.Read`, with the walk of `LzssReader`: the picture stands behind the head, as many bytes of it as
 * the head says, and what is written out is the size the head gives for it. The walk is the one of a window of
 * four thousand and ninety six bytes standing at `0xFEE`, whose every control byte holds eight steps, the
 * lowest place of it first: a step whose place stands is a byte of the picture, and a step whose place does
 * not is a pair of bytes — the second of them holding the first four places of how far behind the byte being
 * written the run begins and its four higher places holding how long the run is, from three bytes up. What
 * the walk does not give stands as nought, which is what the reference's own reader leaves behind.
 */
export function unpackBmd(stored: Buffer, layout: BmdLayout): Buffer {
	const packed = stored.subarray(HEADER_SIZE, HEADER_SIZE + layout.packedSize);
	const unpacked = inflateLzss(packed, {
		outputLength: layout.width * layout.height * 4,
	});
	if (unpacked.length === layout.width * layout.height * 4) return unpacked;
	const pixels: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	unpacked.copy(pixels);
	return pixels;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const blackRainbowBmdImageDescriptor: FormatDescriptor = {
	id: "black-rainbow-bmd-image",
	name: "Black Rainbow bitmap format",
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
			source: "ArcFormats/BlackRainbow/ImageBMD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blackRainbowBmdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blackRainbowBmdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readBmdLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readBmdLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Black Rainbow bitmap");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(layout.packedSize),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The pixels are unwrapped and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readBmdLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Black Rainbow bitmap");
		}
		const pixels = unpackBmd(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
	},
});
