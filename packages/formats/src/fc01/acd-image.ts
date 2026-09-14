// Format reference: GARbro "ArcFormats/FC01/ImageACD.cs", class `AcdFormat` (F&C Co. image format).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { unpackMrgLzss } from "./mrg.js";

/** The reference's word `0x20444341`: `ACD ` with its trailing space. */
const SIGNATURE: Buffer = Buffer.from("ACD ", "latin1");
/** The version the reference compares at offset four, all four of its bytes. */
const VERSION: Buffer = Buffer.from("1.00", "latin1");
const VERSION_OFFSET = 4;
const HEADER_SIZE = 0x1c;
const DATA_OFFSET_FIELD = 8;
const PACKED_SIZE_FIELD = 0x0c;
const UNPACKED_SIZE_FIELD = 0x10;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x18;
const EXTENSIONS: string[] = [];
/**
 * The reference's `AcdDecoder` scales a value with this constant, in a **thirty two bit** multiply whose
 * overflow wraps, and takes the top byte of the product.
 */
const SCALE = 0x28ccccd;
const MAX_IMAGE_BYTES = 256 * 1024 * 1024;

interface AcdLayout {
	width: number;
	height: number;
	dataOffset: number;
	packedSize: number;
	unpackedSize: number;
}

async function readLayout(source: ByteSource): Promise<AcdLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		// A version the reference does not know, or a header that cannot hold the fields it reads, is what its
		// own `NotSupportedException` stands for; the file is still one of these by its word.
		if (
			!header
				.subarray(VERSION_OFFSET, VERSION_OFFSET + VERSION.length)
				.equals(VERSION)
		) {
			return undefined;
		}
		const dataOffset = header.readInt32LE(DATA_OFFSET_FIELD);
		if (dataOffset < HEADER_SIZE) return undefined;
		if (source.size < BigInt(dataOffset)) return undefined;
		const width = header.readUInt32LE(WIDTH_FIELD);
		const height = header.readUInt32LE(HEIGHT_FIELD);
		if (width === 0 || height === 0) return undefined;
		if (width * height > MAX_IMAGE_BYTES) return undefined;
		return {
			width,
			height,
			dataOffset,
			packedSize: header.readInt32LE(PACKED_SIZE_FIELD),
			unpackedSize: header.readInt32LE(UNPACKED_SIZE_FIELD),
		};
	} catch {
		return undefined;
	}
}

/**
 * The reference's `AcdDecoder`: one byte of grey a pixel, read from a bit stream whose bits arrive most
 * significant first. A zero bit is a black pixel, two set bits a white one, and a set bit followed by a clear
 * one reads seven more bits as a number that is scaled into a level — a number of zero being black as well. The
 * buffer holding the bits is marked with a sentinel bit that shifts out after every eighth read, which is how
 * the reader knows to take the next byte of the stream.
 */
export function decodeAcd(input: Buffer, output: Buffer): void {
	let position = 0;
	let bits = 0;
	const getBit = (): number => {
		let bit = bits >> 7;
		bits = (bits << 1) & 0xff;
		if (bits === 0) {
			if (position >= input.length) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"F&C bitmap stream ends in the middle of a pixel",
				);
			}
			bits = input[position] ?? 0;
			position += 1;
			bit = bits >> 7;
			bits = ((bits << 1) & 0xff) | 1;
		}
		return bit;
	};
	for (let destination = 0; destination < output.length; destination += 1) {
		let pixel = 0;
		if (getBit() !== 0) {
			pixel -= 1;
			if (getBit() === 0) {
				pixel += 3;
				let carry = 0;
				do {
					const bit = getBit();
					// The reference's own shorthand adds the value to itself; written out here, the value is the same.
					pixel = pixel + pixel + bit;
					carry = (pixel >> 8) & 1;
					pixel &= 0xff;
				} while (carry === 0);
				if (pixel !== 0) {
					pixel += 1;
					pixel = Math.imul(pixel, SCALE) >>> 24;
				}
			}
		}
		output[destination] = pixel & 0xff;
	}
}

export const fc01AcdImageDescriptor: FormatDescriptor = {
	id: "fc01-acd-image",
	name: "F&C Co. image",
	extensions: EXTENSIONS,
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
			source: "ArcFormats/FC01/ImageACD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fc01AcdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fc01AcdImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		void sourcePath;
		// The reference's own reader throws for a version it does not know rather than declining the file, so
		// the word is what finds it and the version is what fails when the image is read.
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, SIGNATURE.length));
			return header.equals(SIGNATURE);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not supported ACD image version",
			);
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
					// The reference describes twenty four bits and then builds a grey bitmap from its decoder.
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 24,
					packedSize: layout.packedSize,
					unpackedSize: layout.unpackedSize,
				} as Record<string, unknown>,
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "mrg-lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not supported ACD image version",
			);
		const file = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The reference hands the reader exactly the size the header declares, which is why the slice is bounded.
		const packed = file.subarray(
			layout.dataOffset,
			Math.min(file.length, layout.dataOffset + layout.packedSize),
		);
		const unpacked = unpackMrgLzss(packed, layout.unpackedSize);
		const pixels: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
		decodeAcd(unpacked, pixels);
		// `ImageData.Create` with no flip: the bitmap is top down and grey, whatever the metadata says.
		return Readable.from([
			writeBmp8(layout.width, layout.height, pixels, false),
		]);
	},
});
