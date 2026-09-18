// Format reference: GARbro "Legacy/DigitalMonkey/ImagePKT.cs", classes `PktFormat`, `PktMetaData` and
// `PktReader` (a Digital Monkey picture of eight or twenty four bits a pixel, with a plane of fourth bytes
// behind it of its own, and one kind that is only grey). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	writeBmp8,
	writeBmp8Palette,
	writeBmp24,
	writeBmp32,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'PKT10', 'PKT20' and 'PKT99', the words the reference registers. */
const SIGNATURES = [
	Buffer.from("PKT10", "latin1"),
	Buffer.from("PKT20", "latin1"),
	Buffer.from("PKT99", "latin1"),
];
const HEADER_SIZE = 0x30;
/** The two letters behind the mark say the version: ten times the first plus the second, less five hundred
 *  and twenty eight. */
const VERSION_FIRST_FIELD = 3;
const VERSION_SECOND_FIELD = 4;
const VERSION_BIAS = 528;
const VERSIONS = [10, 20, 99];
const MARK_FIELD = 5;
const WIDTH_FIELD = 0x14;
const HEIGHT_FIELD = 0x18;
const DATA_OFFSET_FIELD = 0x20;
const ALPHA_OFFSET_FIELD = 0x24;
const HAS_ALPHA_FIELD = 0x28;
const ALPHA_CHUNKS_FIELD = 0x2c;
/** The colour map of an eight bit picture is two hundred and fifty six entries of three bytes each. */
const PALETTE_SIZE = 0x300;
/** The plane of the grey kind stands four bytes of its own behind its place. */
const GRAY_OFFSET_BIAS = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface PktLayout {
	version: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	dataOffset: number;
	alphaOffset: number;
	hasAlpha: boolean;
	alphaChunks: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PktFormat.ReadMetaData`: the head carries `PKT10`, `PKT20` or `PKT99` — the words the reference registers
 * — a word of nought at five, the width and the height at `0x14` and `0x18`, the place of the pixels at
 * `0x20`, the place of the plane of fourth bytes at `0x24`, a word at `0x28` that says whether that plane is
 * there at all, and the count of its runs at `0x2C`. The depth is twenty four bits for the twentieth version
 * and eight for the other two.
 */
export function readPktLayout(
	data: Buffer,
	fileLength = data.length,
): PktLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!SIGNATURES.some((mark) => data.subarray(0, mark.length).equals(mark))) {
		return undefined;
	}
	if (0 !== (data[MARK_FIELD] ?? 0)) return undefined;
	const version =
		(data[VERSION_FIRST_FIELD] ?? 0) * 10 +
		(data[VERSION_SECOND_FIELD] ?? 0) -
		VERSION_BIAS;
	if (!VERSIONS.includes(version)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (width === 0 || height === 0) return undefined;
	const bitsPerPixel = 20 === version ? 24 : 8;
	const dataOffset = data.readUInt32LE(DATA_OFFSET_FIELD);
	const alphaOffset = data.readUInt32LE(ALPHA_OFFSET_FIELD);
	const hasAlpha = 0 !== data.readInt32LE(HAS_ALPHA_FIELD);
	const alphaChunks = data.readInt32LE(ALPHA_CHUNKS_FIELD);
	const plane = width * height;
	if (plane > LIMIT || plane * (bitsPerPixel >> 3) > LIMIT) return undefined;
	if (99 === version) {
		if (alphaChunks <= 0 || plane > LIMIT) return undefined;
		if (alphaOffset + GRAY_OFFSET_BIAS >= fileLength) return undefined;
		return {
			version,
			width,
			height,
			bitsPerPixel,
			dataOffset,
			alphaOffset,
			hasAlpha: false,
			alphaChunks,
		};
	}
	const pixelBytes = plane * (bitsPerPixel >> 3);
	const pixelsStart = 10 === version ? dataOffset + PALETTE_SIZE : dataOffset;
	if (10 === version && dataOffset + PALETTE_SIZE > fileLength)
		return undefined;
	if (10 === version && pixelsStart + pixelBytes > fileLength) return undefined;
	if (20 === version && dataOffset + pixelBytes > fileLength) return undefined;
	if (hasAlpha) {
		if (alphaChunks <= 0 || alphaOffset >= fileLength) return undefined;
	}
	return {
		version,
		width,
		height,
		bitsPerPixel,
		dataOffset,
		alphaOffset,
		hasAlpha,
		alphaChunks,
	};
}

/** The colour map of an eight bit picture, spread over four byte entries as a bitmap wants it. */
export function readPktPalette(stored: Buffer, layout: PktLayout): Buffer {
	if (10 !== layout.version) return Buffer.alloc(0);
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		const at = layout.dataOffset + entry * 3;
		palette[entry * 4] = stored[at] ?? 0;
		palette[entry * 4 + 1] = stored[at + 1] ?? 0;
		palette[entry * 4 + 2] = stored[at + 2] ?? 0;
	}
	return palette;
}

/**
 * `PktReader.RleUnpack`: as many runs as the head says, every one of them a count and the byte that stands
 * for it. A run that reaches past what it writes is refused, which the reference's own array write answers
 * with an exception as well (a documented deviation in the message only).
 */
export function unpackPktRle(
	stored: Buffer,
	offset: number,
	chunks: number,
	output: Buffer,
): void {
	let position = offset;
	let dst = 0;
	for (let chunk = 0; chunk < chunks; chunk += 1) {
		if (position + 2 > stored.length) {
			throw invalidPicture("Digital Monkey picture is cut short of its runs");
		}
		const count = stored[position] ?? 0;
		const value = stored[position + 1] ?? 0;
		position += 2;
		if (dst + count > output.length) {
			throw invalidPicture("Digital Monkey picture writes past its own end");
		}
		output.fill(value, dst, dst + count);
		dst += count;
	}
}

/**
 * `PktReader.Unpack`: the grey kind of the ninety ninth version is nothing but the runs of its own plane; the
 * other two read their pixels as they stand behind the head — an eight bit picture behind its colour map —
 * and, where the head says there is one, weave a plane of fourth bytes taken from its own runs into every
 * pixel.
 */
export function unpackPkt(stored: Buffer, layout: PktLayout): Buffer {
	const plane = layout.width * layout.height;
	if (99 === layout.version) {
		const grey: Buffer = Buffer.alloc(plane, 0x00);
		unpackPktRle(
			stored,
			layout.alphaOffset + GRAY_OFFSET_BIAS,
			layout.alphaChunks,
			grey,
		);
		return grey;
	}
	const pixelSize = layout.bitsPerPixel >> 3;
	const start =
		10 === layout.version
			? layout.dataOffset + PALETTE_SIZE
			: layout.dataOffset;
	const colour = Buffer.alloc(plane * pixelSize, 0x00);
	for (let index = 0; index < colour.length; index += 1) {
		colour[index] = stored[start + index] ?? 0;
	}
	if (!layout.hasAlpha) return colour;
	const alpha: Buffer = Buffer.alloc(plane, 0x00);
	unpackPktRle(stored, layout.alphaOffset, layout.alphaChunks, alpha);
	const palette = readPktPalette(stored, layout);
	const output: Buffer = Buffer.alloc(plane * 4, 0x00);
	let source = 0;
	for (let index = 0; index < plane; index += 1) {
		if (8 === layout.bitsPerPixel) {
			const entry = (colour[index] ?? 0) * 4;
			output[index * 4] = palette[entry] ?? 0;
			output[index * 4 + 1] = palette[entry + 1] ?? 0;
			output[index * 4 + 2] = palette[entry + 2] ?? 0;
		} else {
			output[index * 4] = colour[source] ?? 0;
			output[index * 4 + 1] = colour[source + 1] ?? 0;
			output[index * 4 + 2] = colour[source + 2] ?? 0;
			source += 3;
		}
		output[index * 4 + 3] = alpha[index] ?? 0;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const digitalMonkeyPktImageDescriptor: FormatDescriptor = {
	id: "digital-monkey-pkt-image",
	name: "Digital Monkey image format",
	extensions: ["pkt", "msk"],
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
			source: "Legacy/DigitalMonkey/ImagePKT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const digitalMonkeyPktImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: digitalMonkeyPktImageDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readPktLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPktLayout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Digital Monkey picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: layout.bitsPerPixel,
					version: layout.version,
					hasAlpha: layout.hasAlpha,
				},
			}),
			// The pixels are read as they stand and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "none",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.hasAlpha ? 32 : layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPktLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Digital Monkey picture");
		}
		const pixels = unpackPkt(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (99 === layout.version) {
			return Readable.from([writeBmp8(layout.width, layout.height, pixels)]);
		}
		if (layout.hasAlpha) {
			return Readable.from([writeBmp32(layout.width, layout.height, pixels)]);
		}
		if (10 === layout.version) {
			return Readable.from([
				writeBmp8Palette(
					layout.width,
					layout.height,
					pixels,
					readPktPalette(stored, layout),
				),
			]);
		}
		return Readable.from([writeBmp24(layout.width, layout.height, pixels)]);
	},
});
