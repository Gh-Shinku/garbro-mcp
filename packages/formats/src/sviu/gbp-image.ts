// Format reference: GARbro "ArcFormats/Sviu/ImageGBP.cs", classes `GbpFormat` and the `GbpReader` beside it
// (tag `GBP`, the picture of the SVIU system). GARbro commit
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
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The picture opens with its own word, which the head behind it does not hide. */
const MARK = Buffer.from("GYBP", "latin1");
const HEAD_SIZE = 0x14;
/** The head of a picture stands hidden behind a key the file carries at its own end. */
const KEY_SIZE = 0x13;
const KEY_LAST = 0x10;
const KEY_PLACES = 0x10;
const WIDTH_FIELD = 0xe;
const HEIGHT_FIELD = 0x10;
const BITS_FIELD = 0x12;
const HEADER_SIZE_FIELD = 4;
const DATA_OFFSET_FIELD = 8;
const METHOD_FIELD = 0xc;
const BITS_24 = 24;
const BITS_32 = 32;
const PLACE_SIZE = 4;
const FLAT_METHOD = 1;
const WALK_METHOD = 2;
const BLOCK_METHOD = 3;
/** The walks of this engine stand of a frame of their own, filled with nothing, from a place of it. */
const FRAME_SIZE = 0x1000;
const FRAME_MASK = FRAME_SIZE - 1;
const FRAME_INIT = 0xfee;
const BIT_MASK = 0x80;
/** A picture stands of blocks of eight places by eight where it stands of the third kind. */
const BLOCK = 8;
/** The two places of the alpha of a picture that name a run of their own. */
const ALPHA_RUNS = new Set([0x00, 0xff]);
const LIMIT = 256 * 1024 * 1024;

export interface GbpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	headerSize: number;
	dataOffset: number;
	method: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `GbpFormat.ReadMetaData`: the head of the picture, taken back out of the key the file ends with. */
export function readGbpLayout(data: Buffer): GbpLayout | undefined {
	if (data.length < HEAD_SIZE + KEY_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const key = data.subarray(data.length - KEY_SIZE);
	const header = Buffer.from(data.subarray(0, HEAD_SIZE));
	// The places of the head stand hidden behind the key: every pair of them turns about, and then a place
	// of the key stands off every place of them.
	for (let at = 4; at < HEAD_SIZE; at += 2) {
		header[at] = (header[at] ?? 0) ^ (key[KEY_LAST] ?? 0);
		header[at + 1] = (header[at + 1] ?? 0) ^ (key[KEY_LAST + 1] ?? 0);
	}
	for (let at = 0; at < KEY_PLACES; at += 1) {
		header[at + 4] = ((header[at + 4] ?? 0) - (key[at] ?? 0)) & 0xff;
	}
	const width = header.readUInt16LE(WIDTH_FIELD);
	const height = header.readUInt16LE(HEIGHT_FIELD);
	const bitsPerPixel = header.readUInt16LE(BITS_FIELD);
	const headerSize = header.readInt32LE(HEADER_SIZE_FIELD);
	const dataOffset = header.readInt32LE(DATA_OFFSET_FIELD);
	const method = header.readUInt16LE(METHOD_FIELD);
	// The reference hands a picture of any other depth over as one of three colours; this port reads the two
	// depths its own reading stands of.
	if (BITS_24 !== bitsPerPixel && BITS_32 !== bitsPerPixel) return undefined;
	if (
		method !== FLAT_METHOD &&
		method !== WALK_METHOD &&
		method !== BLOCK_METHOD
	) {
		return undefined;
	}
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	if (
		headerSize < 0 ||
		dataOffset < 0 ||
		headerSize > data.length ||
		dataOffset > data.length
	) {
		return undefined;
	}
	return { width, height, bitsPerPixel, headerSize, dataOffset, method };
}

/** A place of the picture and the length of it, with the bounds the reference leaves to its own reader. */
function placeAt(data: Buffer, at: number, what: string): number {
	if (at < 0 || at > data.length)
		throw invalidPicture(`The ${what} of the picture stands outside it`);
	return at;
}

function readWord(data: Buffer, at: number): number {
	if (at + 2 > data.length) {
		throw invalidPicture("The places of the picture stand short of the file");
	}
	return data.readUInt16LE(at);
}

/**
 * `GbpReader.LzssUnpack`: the walks of this engine, of a frame of 0x1000 filled with nothing and standing
 * from 0xFEE. A place set in the control bits names a place of the frame and a count of places behind it;
 * a place standing clear names a place of the picture as it stands.
 */
function unpackGbpLzss(
	data: Buffer,
	source: { at: number },
	bits: Buffer,
	bitStart: number,
	output: Buffer,
	outputLength: number,
): void {
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	let framePosition = FRAME_INIT;
	let bitSource = bitStart;
	let bitMask = BIT_MASK;
	for (let destination = 0; destination < outputLength; destination += 1) {
		if (0 === bitMask) {
			bitMask = BIT_MASK;
			bitSource += 1;
		}
		if (0 !== ((bits[bitSource] ?? 0) & bitMask)) {
			const word = readWord(data, source.at);
			source.at += 2;
			let place = word >> 4;
			const count = (word & 0xf) + 3;
			for (let at = 0; at < count; at += 1) {
				if (destination >= outputLength) break;
				const value = frame[place & FRAME_MASK] ?? 0;
				place += 1;
				output[destination] = value;
				frame[framePosition & FRAME_MASK] = value;
				destination += 1;
				framePosition += 1;
			}
			destination -= 1;
		} else {
			const value = data[source.at] ?? 0;
			source.at += 1;
			output[destination] = value;
			frame[framePosition & FRAME_MASK] = value;
			framePosition += 1;
		}
		bitMask >>= 1;
	}
}

/** `GbpReader.UnpackFlat`: the places of a picture, every colour of it standing of its own words. */
function unpackGbpFlat(
	data: Buffer,
	layout: GbpLayout,
	channels: number,
	bitsPositions: number[],
	dataPositions: number[],
	output: Buffer,
): void {
	const channel: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	for (let colour = 0; colour < 3; colour += 1) {
		const start = placeAt(data, bitsPositions[colour] ?? 0, "places");
		const end = placeAt(data, bitsPositions[colour + 1] ?? 0, "places");
		if (end < start)
			throw invalidPicture(
				"The places of the picture stand the wrong way round",
			);
		const bits = data.subarray(start, end);
		const source = { at: placeAt(data, dataPositions[colour] ?? 0, "places") };
		if (FLAT_METHOD === layout.method) {
			let bitSource = 0;
			let bitMask = BIT_MASK;
			let destination = 0;
			while (destination < channel.length) {
				if (0 === bitMask) {
					bitSource += 1;
					bitMask = BIT_MASK;
				}
				if (0 !== ((bits[bitSource] ?? 0) & bitMask)) {
					const word = readWord(data, source.at);
					source.at += 2;
					const count = (word & 0xf) + 3;
					const place = (word >> 4) + 1;
					if (
						!copyOverlapped(channel, destination - place, destination, count)
					) {
						throw invalidPicture("The places of the picture stand outside it");
					}
					destination += count;
				} else {
					channel[destination] = data[source.at] ?? 0;
					source.at += 1;
					destination += 1;
				}
				bitMask >>= 1;
			}
		} else {
			unpackGbpLzss(data, source, bits, 0, channel, channel.length);
		}
		// Every place of a colour stands of the places before it: the places of the channel are carried one
		// after another.
		let destination = colour;
		let carried = 0;
		for (let at = 0; at < channel.length; at += 1) {
			carried = (carried + (channel[at] ?? 0)) & 0xff;
			output[destination] = carried;
			destination += PLACE_SIZE;
		}
	}
	if (4 === channels) {
		// The alpha of a picture stands on its own, as pairs of a place and how many places stand of it.
		let at = PLACE_SIZE - 1;
		const source = { at: placeAt(data, dataPositions[3] ?? 0, "places") };
		while (at < output.length) {
			const value = data[source.at] ?? 0;
			source.at += 1;
			let count = 1;
			if (ALPHA_RUNS.has(value)) {
				count += data[source.at] ?? 0;
				source.at += 1;
			}
			while (count > 0 && at < output.length) {
				output[at] = value;
				at += PLACE_SIZE;
				count -= 1;
			}
		}
	}
}

/** `GbpReader.UnpackBlocks`: the places of a picture standing of blocks of eight places by eight. */
function unpackGbpBlocks(
	data: Buffer,
	layout: GbpLayout,
	channels: number,
	bitsPositions: number[],
	dataPositions: number[],
	output: Buffer,
): void {
	const channel: Buffer = Buffer.alloc(layout.height * layout.width, 0x00);
	const stride = layout.width * PLACE_SIZE;
	const blockStride = stride * BLOCK;
	for (let colour = 0; colour < channels; colour += 1) {
		const start = placeAt(data, bitsPositions[colour] ?? 0, "places");
		const end = placeAt(data, bitsPositions[colour + 1] ?? 0, "places");
		if (end < start || end - start < 12) {
			throw invalidPicture(
				"The places of the picture stand short of its own words",
			);
		}
		const blockBitsLength = data.readInt32LE(start);
		const blockDataLength = data.readInt32LE(start + 4);
		const chunkCount = data.readInt32LE(start + 8);
		if (blockBitsLength < 0 || blockDataLength < 0 || chunkCount < 0) {
			throw invalidPicture("The blocks of the picture stand of nothing");
		}
		const bits = data.subarray(start + 12, end);
		const source = { at: placeAt(data, dataPositions[colour] ?? 0, "places") };
		unpackGbpLzss(
			data,
			source,
			bits,
			blockBitsLength + blockDataLength,
			channel,
			chunkCount,
		);
		let chunk = 0;
		let bitSource = 0;
		let blockSource = blockBitsLength;
		let bitMask = BIT_MASK;
		let blockAt = colour;
		for (let row = 0; row < layout.height; row += BLOCK) {
			const blockHeight = Math.min(BLOCK, layout.height - row);
			let blockX = blockAt;
			for (let column = 0; column < layout.width; column += BLOCK) {
				const blockWidth = Math.min(BLOCK, layout.width - column);
				if (0 === bitMask) {
					bitMask = BIT_MASK;
					bitSource += 1;
				}
				let destination = blockX;
				if (0 !== ((bits[bitSource] ?? 0) & bitMask)) {
					const value = bits[blockSource] ?? 0;
					blockSource += 1;
					for (let y = 0; y < blockHeight; y += 1) {
						let at = destination;
						for (let x = 0; x < blockWidth; x += 1) {
							output[at] = value;
							at += PLACE_SIZE;
						}
						destination += stride;
					}
				} else {
					for (let y = 0; y < blockHeight; y += 1) {
						let at = destination;
						for (let x = 0; x < blockWidth; x += 1) {
							output[at] = channel[chunk] ?? 0;
							chunk += 1;
							at += PLACE_SIZE;
						}
						destination += stride;
					}
				}
				blockX += BLOCK * PLACE_SIZE;
				bitMask >>= 1;
			}
			blockAt += blockStride;
		}
	}
}

/** `GbpReader.Unpack`: the places of the picture, read as the kind of the picture names them. */
export function unpackGbpPicture(data: Buffer, layout: GbpLayout): Buffer {
	const channels = Math.trunc(layout.bitsPerPixel / 8);
	// The words of the picture stand in front of its places: how long the places of every colour stand.
	const table = (at: number, base: number): number[] => {
		const places = [base + 4 * channels];
		if (at + 4 * channels > data.length) {
			throw invalidPicture("The words of the picture stand short of the file");
		}
		for (let colour = 0; colour < channels; colour += 1) {
			places.push(
				(places[colour] ?? 0) + data.readInt32LE(at + colour * PLACE_SIZE),
			);
		}
		return places;
	};
	const bitsPositions = table(layout.headerSize, layout.headerSize);
	const dataPositions = table(layout.dataOffset, layout.dataOffset);
	const output: Buffer = Buffer.alloc(
		layout.width * layout.height * PLACE_SIZE,
		0x00,
	);
	if (BLOCK_METHOD === layout.method) {
		unpackGbpBlocks(
			data,
			layout,
			channels,
			bitsPositions,
			dataPositions,
			output,
		);
	} else {
		unpackGbpFlat(data, layout, channels, bitsPositions, dataPositions, output);
	}
	return writeBmp32(layout.width, layout.height, output);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const gbpImageDescriptor: FormatDescriptor = {
	id: "sviu-gbp-image",
	name: "SVIU system image",
	extensions: ["gbp"],
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
			source: "ArcFormats/Sviu/ImageGBP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gbpImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gbpImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE + KEY_SIZE)) return false;
		try {
			return readGbpLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGbpLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the SVIU system");
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
					bitsPerPixel: layout.bitsPerPixel,
					method: layout.method,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				encryption: "key from the file",
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGbpLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the SVIU system");
		return Readable.from([unpackGbpPicture(data, layout)]);
	},
});
