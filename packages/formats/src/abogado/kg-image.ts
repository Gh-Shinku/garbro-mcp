// Format reference: GARBro "ArcFormats/Abogado/ImageKG.cs", class `KgFormat` with the `KgReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The two letters every picture of this engine opens with, and the two bytes that follow them. */
const WORD = Buffer.from("KG", "latin1");
const LAYOUT_BYTES = [0, 2];
const DEPTH_BYTES = [1, 2];
/** The head holds the size, the place of the colour map and the place the channels begin. */
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
const PALETTE_FIELD = 0x0c;
const DATA_FIELD = 0x10;
/** A head that names this version of the third byte also names where its alpha channel begins. */
const ALPHA_FIELD = 0x2c;
const ALPHA_LAYOUT = 2;
const HEAD_SIZE = 0x30;
/** The two depths, told apart by the fourth byte of the word: two stands for three channels. */
const THREE_CHANNELS = 2;
const BITS_8 = 8;
const BITS_24 = 24;
const BITS_32 = 32;
/** The colour map of an eight bit picture: four bytes to a colour, as a bitmap keeps it. */
const PALETTE_COLOURS = 0x100;
const PALETTE_BYTES = PALETTE_COLOURS * 4;
/** The place a channel may be copied from, named by its own code, and the dictionary it predicts from. */
const COPY_CODES = 5;
const DICTIONARY_SIZE = 0x800;
const DICTIONARY_ENTRIES = 8;
/** A picture this project is willing to hold, and the longest run a channel may name. */
const LIMIT = 256 * 1024 * 1024;
const RUN_LIMIT = 0x1000000;

export interface KgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The size of one pixel of the picture, before any alpha channel is drawn into it. */
	pixelSize: number;
	paletteOffset: number;
	dataOffset: number;
	alphaOffset: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `KgFormat.ReadMetaData`: the word holds its own version in the two bytes behind its letters, the head names
 * the size, where the colour map of an eight bit picture stands and where the channels begin, and a head of
 * the newer version also names where the alpha channel stands.
 */
export function readKgLayout(data: Buffer): KgLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, 2).equals(WORD)) return undefined;
	if (!LAYOUT_BYTES.includes(data[2] ?? 0)) return undefined;
	if (!DEPTH_BYTES.includes(data[3] ?? 0)) return undefined;
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	const bitsPerPixel = THREE_CHANNELS === data[3] ? BITS_24 : BITS_8;
	const dataOffset = data.readInt32LE(DATA_FIELD);
	if (dataOffset < 0 || dataOffset >= data.length) return undefined;
	return {
		width,
		height,
		bitsPerPixel,
		pixelSize: bitsPerPixel / 8,
		paletteOffset: data.readInt32LE(PALETTE_FIELD),
		dataOffset,
		alphaOffset: ALPHA_LAYOUT === data[2] ? data.readInt32LE(ALPHA_FIELD) : 0,
	};
}

/** The dictionary a channel predicts from, which stands as it starts: eight entries to every byte. */
function resetDictionary(): Uint8Array {
	const dictionary = new Uint8Array(DICTIONARY_SIZE);
	for (let at = 0; at < DICTIONARY_SIZE; at += 1) {
		dictionary[at] = at & (DICTIONARY_ENTRIES - 1);
	}
	return dictionary;
}

/** `KgReader.UpdateDict`: the byte a channel drew is moved to the front of the list its neighbour names. */
function updateDictionary(
	dictionary: Uint8Array,
	value: number,
	previous: number,
): void {
	const start = DICTIONARY_ENTRIES * previous;
	let found = 0;
	for (; found < DICTIONARY_ENTRIES; found += 1) {
		if (dictionary[start + found] === value) break;
	}
	if (0 === found) return;
	if (DICTIONARY_ENTRIES === found) found = DICTIONARY_ENTRIES - 1;
	for (let at = found; at > 0; at -= 1) {
		dictionary[start + at] = dictionary[start + at - 1] ?? 0;
	}
	dictionary[start] = value;
}

/** `KgReader.GetCount`: how long a run is, out of four widths of its own. */
function readCount(bits: MsbBitReader): number {
	let count = bits.readBits(2);
	if (0 !== count) return count;
	count = bits.readBits(4);
	if (0 !== count) return count + 3;
	count = bits.readBits(8);
	if (0 !== count) return count;
	count = bits.readBits(16);
	if (0 !== count) return count;
	return (bits.readBits(16) << 16) | bits.readBits(16);
}

/** `KgReader.GetPixel`: a byte of its own, or one out of the dictionary of the byte before it. */
function readPixel(
	bits: MsbBitReader,
	previous: number,
	dictionary: Uint8Array,
): number {
	if (1 === bits.readBits(1)) return bits.readBits(8);
	const start = DICTIONARY_ENTRIES * previous;
	return dictionary[start + bits.readBits(3)] ?? 0;
}

/**
 * `KgReader.UnpackChannel`: one channel of the picture, drawn in a place that steps a pixel at a time. Its
 * first two bytes stand as they are, and behind them every step is either a byte of its own - drawn out of
 * the dictionary of the byte before it or read whole - or a run copied from one of five places: the row
 * behind, its two neighbours, two pixels back and one pixel back.
 */
export function unpackKgChannel(
	layout: KgLayout,
	channel: number,
	output: Buffer,
	bits: MsbBitReader,
	alpha = false,
): void {
	const dictionary = resetDictionary();
	const pixelSize = alpha ? 4 : layout.pixelSize;
	const stride = alpha ? layout.width * 4 : layout.width * layout.pixelSize;
	let destination = channel;
	const check = (what: string): void => {
		if (destination < 0 || destination >= output.length) {
			throw invalidImage(`The ${what} of a channel reaches past the picture`);
		}
	};
	check("first byte");
	output[destination] = bits.readBits(BITS_8);
	destination += pixelSize;
	check("second byte");
	output[destination] = bits.readBits(BITS_8);
	destination += pixelSize;
	while (destination < output.length) {
		if (0 === bits.readBits(1)) {
			const previous = output[destination - pixelSize] ?? 0;
			const value = readPixel(bits, previous, dictionary);
			check("byte");
			output[destination] = value;
			updateDictionary(dictionary, value, previous);
			destination += pixelSize;
			continue;
		}
		let place = 4;
		if (0 !== bits.readBits(1)) place = bits.readBits(2);
		if (place >= COPY_CODES) place = 4;
		const offsets = [
			stride,
			stride - pixelSize,
			stride + pixelSize,
			2 * pixelSize,
			pixelSize,
		];
		const offset = offsets[place] ?? pixelSize;
		const count = readCount(bits);
		if (count > RUN_LIMIT) throw invalidImage("A run of a channel is too long");
		let source = destination - offset;
		for (let drawn = 0; drawn < count; drawn += 1) {
			if (source < 0 || source >= output.length) {
				throw invalidImage("A run of a channel reaches outside the picture");
			}
			check("run");
			output[destination] = output[source] ?? 0;
			destination += pixelSize;
			source += pixelSize;
		}
	}
}

/**
 * `KgReader.Unpack`: the channels of the picture stand one after the other, every one of them behind the
 * place the head names, and an eight bit picture carries its colour map in front of them. A picture that
 * names an alpha channel is drawn as four bytes to the pixel - its colour channels spread into the wider
 * steps first - and the alpha channel follows the same walk into the fourth byte. The reference hands such a
 * picture over without its alpha when that channel fails to read; this port does the same.
 */
export function unpackKg(
	data: Buffer,
	layout: KgLayout,
): {
	pixels: Buffer;
	palette: Buffer | undefined;
} {
	let palette: Buffer | undefined;
	if (BITS_8 === layout.bitsPerPixel) {
		const at = layout.paletteOffset;
		if (at < 0 || at + PALETTE_BYTES > data.length) {
			throw invalidImage("The picture ends inside its colour map");
		}
		palette = Buffer.from(data.subarray(at, at + PALETTE_BYTES));
	}
	const channels = layout.pixelSize;
	const plain = Buffer.alloc(
		layout.width * layout.height * layout.pixelSize,
		0x00,
	);
	// Every channel of the picture walks the **same** stream on, one behind the other, while the dictionary
	// each of them predicts from stands as it starts.
	const bits = new MsbBitReader(data, layout.dataOffset);
	for (let channel = 0; channel < channels; channel += 1) {
		unpackKgChannel(layout, channel, plain, bits);
	}
	if (0 === layout.alphaOffset) {
		return { pixels: plain, palette };
	}
	const drawn = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let destination = 0;
	for (let at = 0; at < layout.width * layout.height; at += 1) {
		const source = at * layout.pixelSize;
		if (palette) {
			const colour = plain[source] ?? 0;
			drawn[destination] = palette[colour * 4] ?? 0;
			drawn[destination + 1] = palette[colour * 4 + 1] ?? 0;
			drawn[destination + 2] = palette[colour * 4 + 2] ?? 0;
		} else {
			drawn[destination] = plain[source] ?? 0;
			drawn[destination + 1] = plain[source + 1] ?? 0;
			drawn[destination + 2] = plain[source + 2] ?? 0;
		}
		destination += 4;
	}
	try {
		// The alpha channel stands at its own place, and the reference resets its stream before it reads it.
		unpackKgChannel(
			layout,
			3,
			drawn,
			new MsbBitReader(data, layout.alphaOffset),
			true,
		);
	} catch {
		// The reference keeps the picture without its alpha channel when that channel does not read; both
		// ways hand over four bytes to the pixel, so what is lost is the alpha alone.
	}
	return { pixels: drawn, palette: undefined };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const kgImageDescriptor: FormatDescriptor = {
	id: "abogado-kg-image",
	name: "AbogadoPowers image",
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
			source: "ArcFormats/Abogado/ImageKG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kgImageDescriptor,
	detection: {
		signatures: LAYOUT_BYTES.flatMap((layout) =>
			DEPTH_BYTES.map((depth) => ({
				bytes: Buffer.from([0x4b, 0x47, layout, depth]),
			})),
		),
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readKgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readKgLayout(await readStored(source));
		if (!layout) throw invalidImage("Not an AbogadoPowers picture");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel:
						0 === layout.alphaOffset ? layout.bitsPerPixel : BITS_32,
				},
			}),
			// The channels are drawn and a bitmap is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 0 === layout.alphaOffset ? layout.bitsPerPixel : BITS_32,
				alphaOffset: layout.alphaOffset,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readKgLayout(stored);
		if (!layout) throw invalidImage("Not an AbogadoPowers picture");
		const { pixels, palette } = unpackKg(stored, layout);
		// The reference builds this picture flipped, so its channels reach the bitmap from the bottom up.
		if (0 !== layout.alphaOffset) {
			return Readable.from([
				writeBmp32(layout.width, layout.height, pixels, true),
			]);
		}
		if (palette) {
			return Readable.from([
				writeBmp8Palette(layout.width, layout.height, pixels, palette, true),
			]);
		}
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
