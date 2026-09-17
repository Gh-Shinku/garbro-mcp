// Format reference: GARbro "ArcFormats/Nexas/ImageGRP.cs", classes `GrpFormat`, `GrpMetaData` and `GrpReader`
// (a NeXAS picture whose control bits are packed apart from its literals and copies). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two letters every signature word of the reference begins with. */
const SIGNATURE = Buffer.from("GR", "latin1");
const HEADER_SIZE = 0x11;
const VERSION_FIELD = 2;
const BITS_FIELD = 3;
const WIDTH_FIELD = 5;
const HEIGHT_FIELD = 9;
const UNPACKED_SIZE_FIELD = 0xd;
/** Where the packed stream begins. */
const STREAM_OFFSET = 0x11;
/** The palette of an eight bit picture stands in the last seven hundred and sixty eight bytes of it. */
const PALETTE_SIZE = 0x300;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface GrpLayout {
	version: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	unpackedSize: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GrpFormat.ReadMetaData`: the first two bytes are `GR`, the third is the version, of which one to three is
 * allowed, the fourth and fifth are the depth, and behind them stand the measurements. A picture of the
 * second version and above declares its own unpacked size at thirteen; of the first version the size is the
 * measurements at the declared depth, with the colour map of an eight bit picture added behind them.
 */
export function readGrpLayout(data: Buffer): GrpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.subarray(0, 2).toString("latin1") !== "GR") return undefined;
	const version = (data[VERSION_FIELD] ?? 0) - 0x30;
	if (version < 1 || version > 3) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readUInt16LE(BITS_FIELD);
	const unpackedSize =
		version > 1
			? data.readInt32LE(UNPACKED_SIZE_FIELD)
			: (width * height * bitsPerPixel) / 8 +
				(bitsPerPixel === 8 ? PALETTE_SIZE : 0);
	if (
		!Number.isSafeInteger(unpackedSize) ||
		unpackedSize < 0 ||
		unpackedSize > LIMIT
	)
		return undefined;
	return { version, width, height, bitsPerPixel, unpackedSize };
}

/**
 * `GrpReader.Decompress`: the length of the control bits stands at `0x11`, a word, and the control bytes
 * themselves behind it, with one more word behind them; the literals and the copies they govern stand behind
 * that. The control bits are read from the lowest bit of every byte up, and of each one a clear bit is a
 * literal byte and a set bit a copy: a word behind it holds the distance and the count, the count in the low
 * bits — three of them for the third version, five for the second — and the distance in the rest, one more
 * than either says. A copy is written a byte at a time, so one that stands one byte behind repeats the byte
 * before it.
 */
export function unpackGrp(input: Buffer, layout: GrpLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.unpackedSize, 0x00);
	if (layout.version < 2) {
		// `GrpReader.Unpack` reads the pixels as they stand from the thirteenth byte; a stream that stops
		// early leaves the rest of the picture as nothing, which is how a region behaves for the reference.
		const start = UNPACKED_SIZE_FIELD;
		if (start > input.length) {
			throw invalidPicture("NeXAS picture is cut short of its pixels");
		}
		const available = Math.min(layout.unpackedSize, input.length - start);
		input.copy(output, 0, start, start + available);
		return output;
	}
	if (STREAM_OFFSET + 8 > input.length) {
		throw invalidPicture("NeXAS picture is cut short of its stream head");
	}
	const declaredBits = input.readInt32LE(STREAM_OFFSET);
	if (declaredBits < 0) {
		throw invalidPicture("NeXAS picture declares a negative control length");
	}
	const controlLength = Math.ceil(declaredBits / 8);
	const controlStart = STREAM_OFFSET + 4;
	const controlEnd = controlStart + controlLength;
	const dataStart = controlEnd + 4;
	if (dataStart > input.length) {
		throw invalidPicture("NeXas picture is cut short of its control bits");
	}
	const control = input.subarray(controlStart, controlEnd);
	const countBits = layout.version > 2 ? 3 : 5;
	const countMask = (1 << countBits) - 1;
	let bitPosition = 0;
	const getBit = (): number => {
		if (bitPosition >= control.length * 8) return -1;
		const byte = control[bitPosition >> 3] ?? 0;
		const bit = (byte >> (bitPosition & 7)) & 1;
		bitPosition += 1;
		return bit;
	};
	let position = dataStart;
	const readByte = (): number => {
		if (position >= input.length) {
			throw invalidPicture("NeXAS picture is cut short of its stream");
		}
		const value = input[position] ?? 0;
		position += 1;
		return value;
	};
	let dst = 0;
	while (dst < output.length) {
		const bit = getBit();
		if (bit < 0) break;
		if (0 === bit) {
			output[dst] = readByte();
			dst += 1;
		} else {
			if (position + 2 > input.length) {
				throw invalidPicture("NeXAS picture is cut short of its stream");
			}
			const word = (input[position] ?? 0) | ((input[position + 1] ?? 0) << 8);
			position += 2;
			const count = (word & countMask) + 1;
			const offset = (word >> countBits) + 1;
			if (dst - offset < 0 || dst + count > output.length) {
				throw invalidPicture("NeXAS picture writes past its own end");
			}
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = output[dst + index - offset] ?? 0;
			}
			dst += count;
		}
	}
	return output;
}

/** `ImageFormat.ReadPalette` with `PaletteFormat.Rgb`: three byte entries of red, green and blue. */
function readGrpPalette(pixels: Buffer): Buffer {
	const entries: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	const start = pixels.length - PALETTE_SIZE;
	for (let index = 0; index < 0x100; index += 1) {
		entries[index * 4] = pixels[start + index * 3 + 2] ?? 0;
		entries[index * 4 + 1] = pixels[start + index * 3 + 1] ?? 0;
		entries[index * 4 + 2] = pixels[start + index * 3] ?? 0;
	}
	return entries;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<GrpLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readGrpLayout(header);
	} catch {
		return undefined;
	}
}

export const nexasGrpImageDescriptor: FormatDescriptor = {
	id: "nexas-grp-image",
	name: "NeXAS engine image format",
	extensions: ["grp"],
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
			source: "ArcFormats/Nexas/ImageGRP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nexasGrpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nexasGrpImageDescriptor,
	// Every signature word of the reference begins with the two letters; the head decides the rest.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const layout = await readLayout(source);
		// The reference's own reader refuses a depth it does not know when it is asked to unpack, so a file
		// that would fail there is not offered as this format.
		return (
			layout !== undefined && [8, 16, 24, 32].includes(layout.bitsPerPixel)
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a NeXAS picture");
		}
		if (![8, 16, 24, 32].includes(layout.bitsPerPixel)) {
			throw invalidPicture(
				`NeXAS picture depth ${layout.bitsPerPixel} is not supported`,
			);
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(
					layout.version < 2 ? UNPACKED_SIZE_FIELD : STREAM_OFFSET,
				),
				size:
					source.size -
					BigInt(layout.version < 2 ? UNPACKED_SIZE_FIELD : STREAM_OFFSET),
				compressed: layout.version >= 2,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					version: layout.version,
				},
			}),
			// The pixels are unfolded from a packed stream and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: layout.version >= 2 ? "custom" : "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				version: layout.version,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a NeXAS picture");
		}
		const stored = await readStored(source);
		const pixels = unpackGrp(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		switch (layout.bitsPerPixel) {
			case 8:
				return Readable.from([
					writeBmp8Palette(
						layout.width,
						layout.height,
						pixels,
						readGrpPalette(pixels),
					),
				]);
			case 16:
				return Readable.from([writeBmp16(layout.width, layout.height, pixels)]);
			case 24:
				return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
			default:
				return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
		}
	},
});
