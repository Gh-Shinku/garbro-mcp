// Format reference: GARbro "ArcFormats/Otemoto/ImageMAG.cs", classes `MagFormat` and `MakiReader` (a picture
// of the Otemoto engine: a head of sixty four places that names the places of the picture, and behind it the
// places of a palette of the places of the picture, the words that name the places of the walk of its places,
// the places that walk reads, and the places the walk stands for itself). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** The head of a picture of this kind stands in sixty four places, and the words it stands behind stand in the
 * first eight of them. */
const HEAD_SIZE = 0x40;
const MARK = "MAKI02  ";
/** The words of the head stand behind a place of their own, which stands as this place. */
const MARK_END = 0x1a;
const MARK_SCAN_FROM = 8;
/** Every word of the head stands in four places, and the words of the head stand in thirty two places behind
 * the place their own words end at: the four places of the picture the words stand for stand four places into
 * them, and the places of the palette stand behind them. */
const HEAD_WORDS_SIZE = 0x20;
const X_FIELD = 0x04;
const Y_FIELD = 0x06;
const RIGHT_FIELD = 0x08;
const BOTTOM_FIELD = 0x0a;
const FLAGS_FIELD = 0x03;
const BITS_OFFSET_FIELD = 0x0c;
const DATA1_OFFSET_FIELD = 0x10;
const DATA1_LENGTH_FIELD = 0x14;
const DATA2_OFFSET_FIELD = 0x18;
const DATA2_LENGTH_FIELD = 0x1c;
/** The words at the place of the flags name how many places a place of the picture stands in: a place of the
 * high bit of the place standing as eight places, and a place of none of it as four. */
const PLACES_EIGHT_BIT = 0x80;
const BITS_FOUR = 4;
const BITS_EIGHT = 8;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/** `MakiReader.x_offs` and `MakiReader.y_offs`: how far beside a place stands, and how far above it stands, for
 * every one of the sixteen commands the walk of a place of a picture may name. */
const X_OFFSETS = [0, 2, 4, 8, 0, 2, 0, 2, 4, 0, 2, 4, 0, 2, 4, 0];
const Y_OFFSETS = [0, 0, 0, 0, -1, -1, -2, -2, -2, -4, -4, -4, -8, -8, -8, -16];

export interface OtemotoMagLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	stride: number;
	paletteOffset: number;
	bitsOffset: number;
	data1Offset: number;
	data1Length: number;
	data2Offset: number;
	data2Length: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MagFormat.ReadMetaData`: the words of the head stand in the first eight places of the file, and the words
 * of the picture stand behind a place of their own which stands as this place; the words at that place name the
 * place of the picture along its row and along its column and the place the picture ends at, which stand as the
 * width and the height of the picture the head stands for. Every other place of the head names where a place of
 * the walk of the picture, the places the walk reads, and the places the walk stands for itself stand.
 */
export function readOtemotoMagLayout(
	data: Buffer,
	fileLength = data.length,
): OtemotoMagLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (data.toString("latin1", 0, MARK.length) !== MARK) return undefined;
	let at = MARK_SCAN_FROM;
	while (at < HEAD_SIZE && data[at] !== MARK_END) at += 1;
	if (at >= HEAD_SIZE) return undefined;
	const headAt = at + 1;
	if (headAt + HEAD_WORDS_SIZE > fileLength) return undefined;
	const x = data.readUInt16LE(headAt + X_FIELD);
	const y = data.readUInt16LE(headAt + Y_FIELD);
	const right = data.readUInt16LE(headAt + RIGHT_FIELD);
	const bottom = data.readUInt16LE(headAt + BOTTOM_FIELD);
	const width = right - x + 1;
	const height = bottom - y + 1;
	if (width <= 0 || height <= 0 || width * height > LIMIT) return undefined;
	const bitsPerPixel =
		((data[headAt + FLAGS_FIELD] ?? 0) & PLACES_EIGHT_BIT) !== 0
			? BITS_EIGHT
			: BITS_FOUR;
	const paletteOffset = headAt + HEAD_WORDS_SIZE;
	const bitsOffset = headAt + data.readInt32LE(headAt + BITS_OFFSET_FIELD);
	const data1Offset = headAt + data.readInt32LE(headAt + DATA1_OFFSET_FIELD);
	// The reference names the places the walk reads by standing the place of the words of the head beside the
	// words of the head that name them and reads that many places, which stands as the places the walk reads.
	const data1Length = headAt + data.readInt32LE(headAt + DATA1_LENGTH_FIELD);
	const data2Offset = headAt + data.readInt32LE(headAt + DATA2_OFFSET_FIELD);
	const data2Length = headAt + data.readInt32LE(headAt + DATA2_LENGTH_FIELD);
	const colours = 1 << bitsPerPixel;
	if (paletteOffset + colours * 3 > fileLength) return undefined;
	if (bitsOffset < 0 || data1Offset < bitsOffset || data1Offset > fileLength) {
		return undefined;
	}
	if (data1Length < 0 || data1Offset + data1Length > fileLength) {
		return undefined;
	}
	if (data2Offset < 0 || data2Offset > fileLength) return undefined;
	const stride = (((width * bitsPerPixel + 31) >> 5) << 2) >>> 0;
	if (stride <= 0) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		stride,
		paletteOffset,
		bitsOffset,
		data1Offset,
		data1Length,
		data2Offset,
		data2Length,
	};
}

/** `MakiReader.ReadPalette`: every place of the palette stands in three places, the places of the red and the
 * blue of it standing the other way round. */
export function readOtemotoMagPalette(
	data: Buffer,
	layout: OtemotoMagLayout,
): Buffer {
	const colours = 1 << layout.bitsPerPixel;
	const palette: Buffer = Buffer.alloc(colours * 3, 0x00);
	for (let colour = 0; colour < colours; colour += 1) {
		const at = layout.paletteOffset + colour * 3;
		palette[colour * 3] = data[at + 1] ?? 0;
		palette[colour * 3 + 1] = data[at] ?? 0;
		palette[colour * 3 + 2] = data[at + 2] ?? 0;
	}
	return palette;
}

/**
 * `MakiReader.Unpack`: the places of the picture stand as places of a walk of their own, every step of it
 * naming a place by how far above it stands and how far beside it stands, or standing as a place the walk reads
 * for itself where it names none; the words that name the places of the walk stand in the places behind the
 * head, every place of them naming eight steps of the walk.
 */
export function unpackOtemotoMag(
	data: Buffer,
	layout: OtemotoMagLayout,
): Uint16Array {
	const places = (layout.stride * layout.height) >> 1;
	const output = new Uint16Array(places);
	const controlBits = data.subarray(layout.bitsOffset, layout.data1Offset);
	const changes = data.subarray(
		layout.data1Offset,
		layout.data1Offset + layout.data1Length,
	);
	const offsets = new Int32Array(16);
	for (let command = 0; command < 16; command += 1) {
		offsets[command] =
			(layout.stride * (Y_OFFSETS[command] ?? 0) - (X_OFFSETS[command] ?? 0)) >>
			1;
	}
	const blocks = Math.floor(layout.width / (32 / layout.bitsPerPixel));
	let bitSource = 0;
	let changeSource = 0;
	let readAt = layout.data2Offset;
	let bitMask = 0;
	let bits = 0;
	const line = new Uint8Array(blocks);
	for (let y = 0; y < layout.height; y += 1) {
		let dst = (layout.stride * y) >> 1;
		for (let x = 0; x < blocks; x += 1) {
			bitMask >>= 1;
			if (0 === bitMask) {
				bits = controlBits[bitSource++] ?? 0;
				bitMask = 0x80;
			}
			if (0 !== (bitMask & bits)) {
				line[x] = (line[x] ?? 0) ^ (changes[changeSource++] ?? 0);
			}
			for (const command of [(line[x] ?? 0) >> 4, (line[x] ?? 0) & 0xf]) {
				if (0 !== command) {
					const source = dst + (offsets[command] ?? 0);
					if (source < 0 || source >= places) {
						throw invalidPicture(
							"Otemoto picture names a place that stands outside it",
						);
					}
					output[dst] = output[source] ?? 0;
				} else {
					if (readAt + 2 > data.length) {
						throw invalidPicture(
							"Otemoto picture is cut short of the places of its walk",
						);
					}
					output[dst] = data.readUInt16LE(readAt);
					readAt += 2;
				}
				dst += 1;
			}
		}
	}
	return output;
}

/** The places of the walk stand as places of two places, which a bitmap of four or eight places a place holds
 * as the places of the picture itself, a row of it standing in as many places as the head of the picture says
 * rather than in the places of a row of the picture. */
export function otemotoMagIndexBytes(
	places: Uint16Array,
	layout: OtemotoMagLayout,
): Buffer {
	const bytes: Buffer = Buffer.alloc(places.length * 2, 0x00);
	for (let at = 0; at < places.length; at += 1) {
		bytes.writeUInt16LE(places[at] ?? 0, at * 2);
	}
	const rowBytes =
		layout.bitsPerPixel === BITS_EIGHT ? layout.width : (layout.width + 1) >> 1;
	const rows: Buffer[] = [];
	for (let y = 0; y < layout.height; y += 1) {
		const from = y * layout.stride;
		rows.push(bytes.subarray(from, from + rowBytes));
	}
	return Buffer.concat(rows);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const otemotoMagImageDescriptor: FormatDescriptor = {
	id: "otemoto-mag-image",
	name: "Otemoto image format",
	extensions: ["mag"],
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
			source: "ArcFormats/Otemoto/ImageMAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const otemotoMagImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: otemotoMagImageDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("MAKI", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return (
				readOtemotoMagLayout(await readStored(source), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readOtemotoMagLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Otemoto picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: 0n,
					size: source.size,
					compressed: true,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readOtemotoMagLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not an Otemoto picture");
		const palette = readOtemotoMagPalette(stored, layout);
		const indices = otemotoMagIndexBytes(
			unpackOtemotoMag(stored, layout),
			layout,
		);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		if (layout.bitsPerPixel === BITS_EIGHT) {
			const entries: Buffer = Buffer.alloc(256 * 4, 0x00);
			for (let colour = 0; colour < 256; colour += 1) {
				entries[colour * 4] = palette[colour * 3 + 2] ?? 0;
				entries[colour * 4 + 1] = palette[colour * 3 + 1] ?? 0;
				entries[colour * 4 + 2] = palette[colour * 3] ?? 0;
			}
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, indices, entries, false),
			]);
		}
		return Readable.from([
			writeBmp4(layout.width, layout.height, indices, palette, false),
		]);
	},
});
