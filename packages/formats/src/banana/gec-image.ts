// Format reference: GARbro "ArcFormats/Banana/ImageGEC.cs", classes `GecFormat`, `GecMetaData` and
// `GecReader` (a picture of the engine of the yellow pig: the places of the picture standing of the places
// of the picture of the walk of the places of them, of the places of the picture of a picture of the words
// of the head of the picture, of the places of the picture of the walk of the places of the picture of the
// places of the picture of their own, of the places of the picture of the walk of the places of the picture
// of a picture of the words of the head of the picture of the pictures of the engine, and of the places of
// the picture of the walk of the places of the picture of the picture of the places of the picture of their
// own). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

const HEAD_SIZE = 0x11;
const ALPHA_HEAD_SIZE = 0x1d;
const WIDTH_FIELD = 5;
const HEIGHT_FIELD = 7;
const ALPHA_OFFSET_FIELD = 9;
const DATA_OFFSET_FIELD = 0xd;
const ALPHA_WIDTH_FIELD = 0x15;
const ALPHA_HEIGHT_FIELD = 0x17;
const ALPHA_DATA_OFFSET_FIELD = 0x19;
/** The places of the picture of a place of the picture of the walk of the places of the picture of the
 * picture of the engine. */
const PLACES_PER_WORD = 32;
const TABLE_SIZE = 0x100;
const FRAME_SIZE = 0x10002;
const CHUNK_SIZE = 0xffff;
const BYTE_COUNT = 3;
const LIMIT = 256 * 1024 * 1024;

export interface GecLayout {
	type: number;
	offsetX: number;
	offsetY: number;
	width: number;
	height: number;
	bitsPerPixel: number;
	alphaOffset: number;
	dataOffset: number;
	/** The places of the picture of the walk of the places of the picture of the picture of the places of the
	 * picture of the walk of them of the picture of the words of the head of the picture of the kind of the
	 * walk of the places of them. */
	alphaWidth: number;
	alphaHeight: number;
	alphaDataOffset: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GecFormat.ReadMetaData`: the words of the head of a picture of this kind name the kind of the walk of the
 * places of the picture, the places of the picture of the walk of the places of the picture standing before
 * the picture of the walk of the places of the picture of the picture, how wide and how tall the picture
 * stands, and the places of the picture of the walk of the places of the picture of the picture of the walk
 * of them.
 */
export function readGecLayout(
	data: Buffer,
	fileLength = data.length,
): GecLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const type = data[0] ?? 0;
	if (type !== 0 && type !== 1) return undefined;
	const offsetX = data.readInt16LE(1);
	const offsetY = data.readInt16LE(3);
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	const alphaOffset = data.readInt32LE(ALPHA_OFFSET_FIELD);
	const dataOffset = data.readInt32LE(DATA_OFFSET_FIELD);
	if (offsetX < 0 || offsetY < 0 || width <= 0 || height <= 0) return undefined;
	if (dataOffset < 0 || dataOffset > fileLength) return undefined;
	if (width * height > LIMIT) return undefined;
	if (type === 1 && alphaOffset <= 0) return undefined;
	const layout: GecLayout = {
		type,
		offsetX,
		offsetY,
		width,
		height,
		bitsPerPixel: type === 0 ? 24 : 32,
		alphaOffset,
		dataOffset,
		alphaWidth: 0,
		alphaHeight: 0,
		alphaDataOffset: 0,
	};
	if (type === 1) {
		// The reference stands the words of the head of the picture of the places of the picture of the walk
		// of the places of the picture of the picture of the places of the picture of the walk of them behind
		// the words of the head of the picture of the kind of the walk of the places of them.
		if (fileLength < ALPHA_HEAD_SIZE || data.length < ALPHA_HEAD_SIZE)
			return undefined;
		layout.alphaWidth = data.readUInt16LE(ALPHA_WIDTH_FIELD);
		layout.alphaHeight = data.readUInt16LE(ALPHA_HEIGHT_FIELD);
		layout.alphaDataOffset = data.readInt32LE(ALPHA_DATA_OFFSET_FIELD);
		if (layout.alphaWidth <= 0 || layout.alphaHeight <= 0) return undefined;
	}
	return layout;
}

/**
 * `GecReader.GetNextBit`: the places of the picture of the walk of the places of the picture stand as the
 * places of the picture of the words of the walk of the picture, the places of the picture of the walk of
 * the places of the picture of a picture of their own standing of the places of the picture of a word of the
 * walk of the places of them behind the places of the picture of the walk of the picture of the places of
 * the picture of the places of the picture of the word of the walk of the places of them.
 */
class GecBitReader {
	private bits = 0;
	private bitsSrc: number;
	private bitsCount = 0;

	constructor(
		private readonly input: Buffer,
		bitsSrc: number,
	) {
		this.bitsSrc = bitsSrc;
	}

	/** `GecReader.GetNextBit`: the places of the picture of the walk of the places of a picture of this kind
	 * stand of the places of the picture of the words of the walk of the picture, of the places of the
	 * picture of the walk of the places of the picture of the place of the picture of the walk of them. */
	nextBit(): number {
		// The reference stands the places of the picture of the walk of the places of the picture of the
		// places of the picture of the word of the walk of them of the places of the picture of the walk of
		// them before the places of the picture of the walk of the places of the picture of the place of the
		// picture of the walk of them, so a word of the walk of the places of the picture stands for two and
		// thirty places of the picture of the walk of the places of the picture.
		const count = this.bitsCount;
		this.bitsCount = count - 1;
		if (count <= 0) {
			if (this.bitsSrc + 4 > this.input.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			this.bits = this.input.readInt32LE(this.bitsSrc);
			this.bitsSrc += 4;
			this.bitsCount = PLACES_PER_WORD - 1;
		} else {
			this.bits >>= 1;
		}
		return this.bits & 1;
	}

	/** `GecReader.GetInt`: the places of the picture of the walk of the places of the picture stand of a
	 * picture of the places of the picture of the walk of them of the places of the picture of the walk of
	 * the picture of the places of the picture of their own, the places of the picture of the walk of the
	 * places of the picture of the picture of the place of the picture of the walk of the places of them
	 * standing behind the places of the picture of the walk of the places of the picture of the place of the
	 * picture of the walk of them. */
	nextValue(): number {
		let count = 0;
		while (this.nextBit() === 0) count += 1;
		let value = 1;
		while (count > 0) {
			value = (value << 1) | this.nextBit();
			count -= 1;
		}
		return value;
	}
}

/**
 * `GecReader.ReadFrame`: the places of the picture of the walk of the places of the picture stand as the
 * places of the picture of the words of the walk of the picture, and as the runs of the places of the
 * picture of no places of their own where the places of the walk of the picture stand for the places of the
 * picture of the walk of them of their own.
 */
function readGecFrame(
	reader: GecBitReader,
	frame: Buffer,
	count: number,
): void {
	let at = 0;
	while (at < count) {
		if (reader.nextBit() !== 0) {
			frame[at] = reader.nextValue() & 0xff;
			at += 1;
		} else {
			// The reference stands the places of the picture of the walk of the places of the picture of the
			// walk of them beyond the places of the picture of the walk of the places of the picture of the
			// walk of the places of the picture of the word of the walk of the picture of the places of their
			// own where the places of the picture of the walk of the places of the picture of the walk of them
			// stand short of the places of the picture of the walk of them.
			const run = reader.nextValue();
			for (let i = 0; i < run && at < count; i += 1) {
				frame[at] = 0;
				at += 1;
			}
		}
	}
}

/**
 * `GecReader.UnpackFrame1`: the places of the picture of the walk of the places of the picture of the
 * picture of the words of the head of the picture of the places of the picture of the walk of them: the
 * places of the picture stand as the places of the picture of the walk of the places of the picture of a
 * picture of their own, the places of the picture of the walk of them standing before the places of the
 * picture of the walk of the places of the picture of the picture of the places of the picture of the walk
 * of them.
 */
function unpackGecFrame1(
	frame: Buffer,
	dst: Buffer,
	count: number,
	table: Buffer,
): void {
	let previous = 1;
	for (let at = 0; at < count; at += 1) {
		const code = frame[at] ?? 0;
		const place = table[code] ?? 0;
		if (code === 1) {
			// The reference stands the places of the picture of the walk of the places of the picture of the
			// place of the picture of the walk of them of the picture of the place of the picture of the walk
			// of the places of the picture of the picture of their own where the places of the picture of the
			// walk of the places of the picture of the place of the picture of the walk of them stand not.
			if (previous !== 0) {
				table[1] = table[0] ?? 0;
				table[0] = place;
			}
		} else if (code > 1) {
			// The reference stands the places of the picture of the walk of the places of the picture of the
			// walk of them behind the places of the picture of the walk of the places of the picture of the
			// place of the picture of the walk of them of the picture of the places of the picture of the walk
			// of them of the picture of their own.
			table.copyWithin(2, 1, code);
			table[1] = place;
		}
		dst[at] = place;
		previous = code;
	}
}

/**
 * `GecReader.UnpackFrame2`: the places of the picture standing of the places of the picture of the walk of
 * the places of the picture of a picture of the words of the head of the picture of the places of the
 * picture of the walk of the places of the picture of the pictures of the engine. The places of the picture
 * of the walk of the places of the picture stand of the places of the picture of the walk of the places of
 * the picture of the place of the picture of the walk of the places of the picture of the picture standing
 * beside the places of the picture of the walk of the places of the picture of the walk of them, the places
 * of the picture of the walk of the places of the picture standing of the places of the picture of the walk
 * of them of the picture of the walk of the places of the picture of the picture of their own.
 */
function unpackGecFrame2(
	frame: Buffer,
	src: number,
	count: number,
	first: number,
	output: Buffer,
	dst: number,
): number {
	const counts = new Uint16Array(TABLE_SIZE);
	const offsets = new Uint16Array(TABLE_SIZE);
	const order = new Uint16Array(FRAME_SIZE);
	for (let i = 0; i < count; i += 1)
		counts[frame[src + i] ?? 0] = (counts[frame[src + i] ?? 0] ?? 0) + 1;
	let total = 0;
	for (let i = 0; i < TABLE_SIZE; i += 1) {
		offsets[i] = total;
		total = (total + (counts[i] ?? 0)) & 0xffff;
		counts[i] = 0;
	}
	for (let i = 0; i < count; i += 1) {
		const place = frame[src + i] ?? 0;
		const a = offsets[place] ?? 0;
		const b = counts[place] ?? 0;
		counts[place] = b + 1;
		order[a + b] = i;
	}
	let next = order[first] ?? 0;
	let at = dst;
	for (let left = count; left > 0; left -= 1) {
		output[at] = frame[src + next] ?? 0;
		at += 1;
		next = order[next] ?? 0;
	}
	return at;
}

/**
 * `GecReader.UnpackRLE`: the places of the picture of the walk of the places of the picture stand as the
 * places of the picture of the walk of the places of the picture of the picture of their own, and as the
 * runs of the places of the picture of the walk of the places of them.
 */
function unpackGecRle(
	reader: GecBitReader,
	input: Buffer,
	src: number,
	output: Buffer,
	dst: number,
	count: number,
): { src: number; dst: number } {
	let from = src;
	let at = dst;
	let left = count;
	while (left > 0) {
		if (reader.nextBit() === 0) {
			if (from + BYTE_COUNT > input.length || at + BYTE_COUNT > output.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			for (let i = 0; i < BYTE_COUNT; i += 1) {
				output[at] = input[from] ?? 0;
				at += 1;
				from += 1;
			}
			left -= BYTE_COUNT;
		} else {
			const run = reader.nextValue() * BYTE_COUNT;
			if (
				run < BYTE_COUNT ||
				from + BYTE_COUNT > input.length ||
				at + run > output.length
			)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture of the runs of them stand short of the places of the picture",
				);
			for (let i = 0; i < BYTE_COUNT; i += 1) {
				output[at] = input[from] ?? 0;
				at += 1;
				from += 1;
			}
			// The places of the picture of the walk of the places of the picture of the picture of their own
			// stand of the places of the picture of the picture of the walk of them of the places of the
			// picture of the walk of the places of the picture of the walk of them.
			copyOverlapped(output, at - BYTE_COUNT, at, run - BYTE_COUNT);
			at += run - BYTE_COUNT;
			left -= run;
		}
	}
	return { src: from, dst: at };
}

/** `Binary.CopyOverlapped`: the places of the picture of the walk of the places of the picture stand of the
 * places of the picture of the walk of the places of the picture behind them where the places of the picture
 * of the walk of the places of the picture of the picture of their own stand behind the places of the
 * picture of the walk of the places of the picture. */
function copyOverlapped(
	data: Buffer,
	src: number,
	dst: number,
	count: number,
): void {
	if (dst > src) {
		let at = dst;
		let left = count;
		while (left > 0) {
			const step = Math.min(dst - src, left);
			data.copy(data, at, src, src + step);
			at += step;
			left -= step;
		}
	} else {
		data.copy(data, dst, src, src + count);
	}
}

/**
 * `GecReader.UnpackPixels`: the places of the picture of the walk of the places of the picture of a picture
 * of this kind. Every place of the walk of the places of the picture stands for the places of the picture of
 * a picture of the words of the head of the picture of the places of the picture of the walk of them of
 * their own, and for a picture of the places of the picture of the walk of the places of the picture of the
 * picture of their own.
 */
function unpackGecPixels(data: Buffer, layout: GecLayout): Buffer {
	const output = Buffer.alloc(layout.width * layout.height * BYTE_COUNT);
	// The reference stands the places of the picture of the walk of the places of the picture of the picture
	// at the words of the head of the picture of the kind of the walk of them, and the places of the picture
	// of the walk of the places of the picture of the picture of their own behind the places of the picture
	// of the walk of them of the places of the picture of the walk of the places of the picture of the words
	// of the head of the picture — so the words of the walk of the places of the picture of the places of the
	// picture of the walk of them stand of the places of the picture of the words of the head of the picture
	// of the kind of the walk of the places of them.
	const reader = new GecBitReader(
		data,
		layout.type === 0 ? HEAD_SIZE : ALPHA_HEAD_SIZE,
	);
	const table = Buffer.alloc(TABLE_SIZE);
	for (let i = 0; i < TABLE_SIZE; i += 1) table[i] = i;
	const frame1 = Buffer.alloc(FRAME_SIZE);
	const frame2 = Buffer.alloc(FRAME_SIZE);
	let src =
		(layout.type === 0 ? HEAD_SIZE : ALPHA_HEAD_SIZE) + layout.dataOffset;
	let dst = 0;
	while (dst < output.length) {
		const count = Math.min(output.length - dst, CHUNK_SIZE);
		if (reader.nextBit() !== 0) {
			readGecFrame(reader, frame1, count + 2);
			unpackGecFrame1(frame1, frame2, count + 2, table);
			dst = unpackGecFrame2(
				frame2,
				2,
				count,
				frame2.readUInt16LE(0),
				output,
				dst,
			);
		} else {
			const walked = unpackGecRle(reader, data, src, output, dst, count);
			src = walked.src;
			dst = walked.dst;
		}
	}
	return output;
}

/**
 * `GecReader.UnpackAlpha`: the places of the picture of the walk of the places of the picture of the picture
 * of the places of the picture of the walk of them of their own.
 */
function unpackGecAlpha(data: Buffer, layout: GecLayout): Buffer {
	const bits = ALPHA_HEAD_SIZE + layout.alphaOffset;
	const dataSrc = bits + layout.alphaDataOffset;
	const reader = new GecBitReader(data, bits);
	const alpha = Buffer.alloc(layout.alphaWidth * layout.alphaHeight);
	let from = dataSrc;
	let dst = 0;
	while (dst < alpha.length) {
		if (from >= data.length)
			throw invalidPicture(
				"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
			);
		const value = data[from] ?? 0;
		from += 1;
		if (reader.nextBit() !== 0) {
			const run = reader.nextValue();
			for (let i = 0; i < run && dst < alpha.length; i += 1) {
				alpha[dst] = value;
				dst += 1;
			}
		} else {
			alpha[dst] = value;
			dst += 1;
		}
	}
	return alpha;
}

/**
 * `GecReader.ApplyAlpha`: the places of the picture of the walk of the places of the picture of the picture
 * of the places of the picture of their own stand beside the places of the picture of the walk of the places
 * of the picture of the picture of the places of the picture of the walk of them.
 */
function applyGecAlpha(
	places: Buffer,
	alpha: Buffer,
	layout: GecLayout,
): Buffer {
	const output = Buffer.alloc(layout.width * layout.height * 4);
	let src = 0;
	const alphaY = layout.alphaHeight - layout.height - layout.offsetY;
	let alphaSrc = alphaY * layout.alphaWidth + layout.offsetX;
	let dst = 0;
	for (let y = 0; y < layout.height; y += 1) {
		for (let x = 0; x < layout.width; x += 1) {
			output[dst] = places[src] ?? 0;
			output[dst + 1] = places[src + 1] ?? 0;
			output[dst + 2] = places[src + 2] ?? 0;
			const at = alphaSrc + x;
			if (at < 0 || at >= alpha.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture of the picture of the places of the picture of the walk of them stand short of the places of the picture",
				);
			output[dst + 3] = alpha[at] ?? 0;
			src += BYTE_COUNT;
			dst += 4;
		}
		alphaSrc += layout.alphaWidth;
	}
	return output;
}

/** `GecReader.Unpack`: the places of the picture of the walk of the places of the picture of a picture of
 * this kind. */
export function unpackGecPicture(
	data: Buffer,
	layout: GecLayout,
): { places: Buffer; bitsPerPixel: number } {
	const places = unpackGecPixels(data, layout);
	if (layout.type === 0) return { places, bitsPerPixel: 24 };
	return {
		places: applyGecAlpha(places, unpackGecAlpha(data, layout), layout),
		bitsPerPixel: 32,
	};
}

export const bananaGecImageDescriptor: FormatDescriptor = {
	id: "banana-gec-image",
	name: "Yellow Pig image format",
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
			source: "ArcFormats/Banana/ImageGEC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bananaGecImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bananaGecImageDescriptor,
	// The reference stands the words of the head of a picture of this kind of no places of the picture of the
	// walk of them of its own, so the walk of the places of the picture of the kind of the places of the
	// picture of the walk of them of the picture of the words of the head of the picture of the places of the
	// picture of the walk of the places of the picture stands of the places of the picture of the walk of the
	// places of the picture of the picture of their own.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(await source.readAt(0n, HEAD_SIZE));
			return readGecLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readGecLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		return {
			entries: [
				createFixedEntry({
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
						offsetX: layout.offsetX,
						offsetY: layout.offsetY,
					},
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readGecLayout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a picture of this kind");
		const { places, bitsPerPixel } = unpackGecPicture(stored, layout);
		// The reference stands the places of the picture of the walk of the places of the picture of the
		// picture of the places of the picture of the walk of them of the picture of the places of the
		// picture of the walk of the places of the picture of the picture of their own, so the places of the
		// picture of the walk of the places of the picture stand of the places of the picture of the walk of
		// the places of the picture of the picture of the walk of them of the picture of the picture of the
		// walk of the places of the picture.
		const bottomUp = true;
		return Readable.from([
			bitsPerPixel === 24
				? writeBmp24(layout.width, layout.height, places, bottomUp)
				: writeBmp32(layout.width, layout.height, places, bottomUp),
		]);
	},
});
