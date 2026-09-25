// Format reference: GARBro "Legacy/Adviz/ImageGIZ.cs", class `Giz3Format` with the `Giz3Reader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type { ByteSource, FormatDescriptor } from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("GIZ3", "latin1");
const HEAD_SIZE = 0x10;
/** Where the picture stands inside the screen it was drawn on: eighty pictures to a row, eight places to a byte. */
const PICTURE_PLACE_WIDTH = 0x50;
const PLACES_PER_STRIP = 8;
/** A picture of this engine is always four places to a strip. */
const BITS_PER_PLACE = 4;
/** The places of a picture: one byte holds two of them, and one plane of one strip stands at a place of its own. */
const PLACES_PER_BYTE = 2;
const PLANE_SIZE = 0x800;
const STRIP_SIZE = 0x200;
const STRIPS = 4;
const BUFFER_SIZE = STRIP_SIZE * STRIPS * BITS_PER_PLACE;
/** The tree of the tokens of a picture: a word of how long it is, then two of them to every three bytes. */
const TOKENS_PER_RECORD = 2;
const RECORD_SIZE = 3;
const TREE_HEAD_SIZE = 2;
const LEAF_BIT = 0x800;
/** A token below this many stands for a place of its own, and above it for a run behind one. */
const PLACE_TOKEN = 0x10;
const RUN_BIAS = 2;
/** The ways a run reaches back into the places of a picture, as the token behind a run names them. */
const RUN_NEIGHBOUR_1 = 2;
const RUN_NEIGHBOUR_2 = 3;
const RUN_FAR_FIRST = 4;
const RUN_FAR_LAST = 6;
const RUN_STRIP_BEHIND = 7;
const RUN_STRIP_TWO_BEHIND = 8;
const RUN_FILL = 0;
const RUN_FILL_LAST = 1;
/** The colour map of a picture: sixteen colours of three bytes, every one of them spread over a byte. */
const PALETTE_PLACES = 16;
const PALETTE_PLACE_SIZE = 3;
const PLACE_STEP = 0x11;
const PALETTE_SIZE = PALETTE_PLACES * PALETTE_PLACE_SIZE;
/** The places the picture is drawn in when it carries no colour map of its own. */
const DEFAULT_PLACE = 0x11;
const LIMIT = 256 * 1024 * 1024;

export interface Giz3Layout {
	width: number;
	height: number;
	offsetX: number;
	offsetY: number;
	planeMap: number;
	hasPalette: boolean;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Giz3Format.ReadMetaData`: the picture names where it stands inside the screen it was drawn on, the strips
 * it is made of, how many rows it has, and whether it carries a colour map of its own. The places it is drawn
 * with are chosen by the map of its planes.
 */
export function readGiz3Layout(data: Buffer): Giz3Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	const position = data.readUInt16LE(4);
	const width = data.readUInt16LE(6) * PLACES_PER_STRIP;
	const height = data.readUInt16LE(8);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return {
		width,
		height,
		offsetX: (position % PICTURE_PLACE_WIDTH) * PLACES_PER_STRIP,
		offsetY: Math.floor(position / PICTURE_PLACE_WIDTH),
		hasPalette: 0 !== (data[0xc] ?? 0),
		planeMap: data[0xe] ?? 0,
	};
}

/** The colour map of a picture: blue, red, green to a colour, every byte spread over the whole of it. */
export function readGiz3Palette(data: Buffer, offset: number): Buffer {
	const palette = Buffer.alloc(PALETTE_PLACES * 4, 0x00);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		const base = offset + at * PALETTE_PLACE_SIZE;
		const b = data[base] ?? 0;
		const r = data[base + 1] ?? 0;
		const g = data[base + 2] ?? 0;
		palette[at * 4] = (b * PLACE_STEP) & 0xff;
		palette[at * 4 + 1] = (g * PLACE_STEP) & 0xff;
		palette[at * 4 + 2] = (r * PLACE_STEP) & 0xff;
	}
	return palette;
}

/** The colour map a picture falls back on, the one the reference's own viewer hands it. */
export function defaultGiz3Palette(): Buffer {
	const palette = Buffer.alloc(PALETTE_PLACES * 4, 0x00);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		const value = at * DEFAULT_PLACE;
		palette[at * 4] = value;
		palette[at * 4 + 1] = value;
		palette[at * 4 + 2] = value;
	}
	return palette;
}

/**
 * `Giz3Reader.ReadHuffmanTree`: a word names how long the tree of the tokens of a picture is, and every record
 * of three bytes behind it holds two of its nodes. A node whose highest bit is set stands for a token of its
 * own; one that is clear stands for the place of a record of its own, counted from the second node of the
 * tree. The root of the tree is the second node from its end.
 */
export function readGiz3Tree(
	data: Buffer,
	offset: number,
): { table: number[]; root: number; end: number } {
	if (offset + TREE_HEAD_SIZE > data.length) {
		throw invalidPicture("The picture ends inside the tree of its tokens");
	}
	const length = data.readUInt16LE(offset);
	if (length < TREE_HEAD_SIZE) {
		throw invalidPicture(
			"The tree of the tokens of a picture stands short of its own head",
		);
	}
	const table: number[] = [];
	const read = (value: number): number => {
		if (0 === (value & LEAF_BIT)) return (value - RUN_BIAS) >> 1;
		return value;
	};
	for (let at = TREE_HEAD_SIZE; at + 1 < length; at += RECORD_SIZE) {
		if (offset + at + RECORD_SIZE > data.length) {
			throw invalidPicture("The picture ends inside the tree of its tokens");
		}
		const word = data.readUInt16LE(offset + at);
		const third = data[offset + at + 2] ?? 0;
		table.push(read(word & 0xfff));
		table.push(read((third << 4) | (word >> 12)));
	}
	return {
		table,
		root: table.length - TOKENS_PER_RECORD,
		end: offset + length,
	};
}

/** The bits of a picture are read from the highest bit of a word down, one word behind the other. */
class Giz3Bits {
	private readonly data: Buffer;
	private position: number;
	private bits = 0;
	private left = 1;

	constructor(data: Buffer, position: number) {
		this.data = data;
		this.position = position;
	}

	next(): boolean {
		if (this.left <= 0 || 1 === this.left) {
			if (this.position + 2 > this.data.length) {
				throw invalidPicture(
					"The bits of a picture stand short of the picture",
				);
			}
			this.bits = this.data.readUInt16LE(this.position);
			this.position += 2;
			this.left = 16;
		}
		const bit = 0 !== (this.bits & 0x8000);
		this.bits = (this.bits << 1) & 0xffff;
		this.left -= 1;
		return bit;
	}
}

/**
 * `Giz3Reader.ReadToken`: the tree is walked from its root, a set bit taking the node behind the one the walk
 * stands at, until a node that stands for a token of its own is reached.
 */
function readGiz3Token(
	bits: Giz3Bits,
	table: readonly number[],
	root: number,
): number {
	let token = root;
	do {
		if (bits.next()) token += 1;
		const next = table[token];
		if (undefined === next) {
			throw invalidPicture(
				"The tree of a picture stands short of its own nodes",
			);
		}
		token = next;
	} while (0 === (token & LEAF_BIT));
	return token & 0xff;
}

/**
 * `Giz3Reader.Unpack`: the places of the picture are walked strip by strip. A plane the map of the planes
 * names is read out of the bits of the picture; one it does not stays as the strip before it left it.
 */
export function unpackGiz3Tokens(
	data: Buffer,
	layout: Giz3Layout,
): { ring: Buffer; places: Buffer } {
	const start = HEAD_SIZE + (layout.hasPalette ? PALETTE_SIZE : 0);
	const tree = readGiz3Tree(data, start);
	const bits = new Giz3Bits(data, tree.end);
	const buffer = Buffer.alloc(BUFFER_SIZE, 0x00);
	// The places of the picture stand apart from the ring of the planes they are drawn out of.
	const places = Buffer.alloc(
		((layout.width * BITS_PER_PLACE) / 8) * layout.height,
		0x00,
	);
	const height = layout.height;
	let strip = 0;
	let position = 0;
	let behind = 0;

	const unpackPlane = (dst: number): void => {
		let y = 0;
		while (y < height) {
			const control = readGiz3Token(bits, tree.table, tree.root);
			if (control < PLACE_TOKEN) {
				if (dst < buffer.length) buffer[dst] = control;
				dst += 1;
				y += 1;
				continue;
			}
			const count = readGiz3Token(bits, tree.table, tree.root) + RUN_BIAS;
			const way = control - PLACE_TOKEN;
			switch (way) {
				case RUN_FILL:
				case RUN_FILL_LAST: {
					const value = RUN_FILL === way ? 0x00 : 0x0f;
					for (let drawn = 0; drawn < count; drawn += 1) {
						if (dst + drawn < buffer.length) buffer[dst + drawn] = value;
					}
					break;
				}
				case RUN_NEIGHBOUR_1:
				case RUN_NEIGHBOUR_2: {
					// The second way reaches back one place, the third two.
					copyOverlapped(buffer, dst - (way - 1), dst, count);
					break;
				}
				case RUN_FAR_FIRST:
				case RUN_FAR_FIRST + 1:
				case RUN_FAR_LAST: {
					// The three ways beyond them reach back into the planes before the one they stand in.
					const far = (way - RUN_NEIGHBOUR_2) * PLANE_SIZE;
					copyOverlapped(buffer, dst - far, dst, count);
					break;
				}
				case RUN_STRIP_BEHIND:
				case RUN_STRIP_TWO_BEHIND: {
					const back = way - RUN_STRIP_BEHIND + 1;
					const stripAt = (strip - back) & (STRIPS - 1);
					const source = dst - position + (stripAt << 9) + behind;
					copyOverlapped(buffer, source, dst, count);
					break;
				}
				default:
					// A token the reference draws nothing for: it steps over the run and reads the next one.
					break;
			}
			dst += count;
			y += count;
		}
	};

	// A strip covers eight places, and the two halves of it four each.
	const strips = layout.width / PLACES_PER_STRIP;
	let dst = 0;
	for (let x = 0; x < strips; x += 1) {
		const first = position;
		let second = 0;
		for (let half = 0; half < 2; half += 1) {
			second = position;
			let mask = 1;
			for (let plane = 0; plane < BITS_PER_PLACE; plane += 1) {
				if (0 === (layout.planeMap & mask)) unpackPlane(position);
				mask <<= 1;
				position += PLANE_SIZE;
				behind += PLANE_SIZE;
			}
			strip = (strip + 1) & (STRIPS - 1);
			position = strip << 9;
			behind = 0;
		}
		dst = copyGiz3Planes(buffer, places, layout, first, second, dst);
	}
	return { ring: buffer, places };
}

/**
 * `Giz3Reader.CopyPlanes`: the four planes of a strip stand one behind the other, and two of them of every
 * plane of a strip - the one before the strip and the one behind it - fill the places of a picture between
 * them: the first names the place above, the second the place below.
 */
function copyGiz3Planes(
	buffer: Buffer,
	output: Buffer,
	layout: Giz3Layout,
	first: number,
	second: number,
	dst: number,
): number {
	const stride = (layout.width * BITS_PER_PLACE) / 8;
	for (let y = 0; y < layout.height; y += 1) {
		const planes: number[] = [];
		for (let plane = 0; plane < BITS_PER_PLACE; plane += 1) {
			const high = buffer[first + y + plane * PLANE_SIZE] ?? 0;
			const low = buffer[second + y + plane * PLANE_SIZE] ?? 0;
			planes.push(((high << 4) | low) & 0xff);
		}
		for (let j = 0; j < PLACES_PER_STRIP; j += PLACES_PER_BYTE) {
			let place = 0;
			let low = 0;
			for (let plane = 0; plane < BITS_PER_PLACE; plane += 1) {
				const packed = planes[plane] ?? 0;
				const top = ((packed << j) & 0x80) >>> (3 - plane);
				const bottom = ((packed << j) & 0x40) >>> (6 - plane);
				place |= top;
				low |= bottom;
			}
			const at = dst + j / PLACES_PER_BYTE;
			if (at < output.length) output[at] = (place | low) & 0xff;
		}
		dst += stride;
	}
	return dst;
}

/** The places of a picture, one byte to a place, for a bitmap that holds a byte to a place. */
export function giz3ExpandPlaces(places: Buffer, layout: Giz3Layout): Buffer {
	const stride = (layout.width * BITS_PER_PLACE) / 8;
	const output = Buffer.alloc(layout.width * layout.height, 0x00);
	for (let y = 0; y < layout.height; y += 1) {
		for (let at = 0; at < stride; at += 1) {
			const packed = places[y * stride + at] ?? 0;
			const x = at * PLACES_PER_BYTE;
			output[y * layout.width + x] = packed >> 4;
			if (x + 1 < layout.width) {
				output[y * layout.width + x + 1] = packed & 0x0f;
			}
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const giz3ImageDescriptor: FormatDescriptor = {
	id: "adviz-giz3-image",
	name: "ADVIZ engine image",
	extensions: ["giz"],
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
			source: "Legacy/Adviz/ImageGIZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const advizGiz3ImageFormat = defineFixedArchive({
	descriptor: giz3ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		const head = await source.readAt(0n, HEAD_SIZE);
		return head.subarray(0, MARK.length).equals(MARK);
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGiz3Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the ADVIZ engine");
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
					bitsPerPixel: BITS_PER_PLACE,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
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
				bitsPerPixel: BITS_PER_PLACE,
				hasPalette: layout.hasPalette,
				planeMap: layout.planeMap,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGiz3Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the ADVIZ engine");
		// The colour map stands in front of the tree of the tokens; a picture without one falls back on the
		// places the reference's own viewer hands it, the colour map of the game standing beside the game.
		const palette = layout.hasPalette
			? readGiz3Palette(data, HEAD_SIZE)
			: defaultGiz3Palette();
		const drawn = unpackGiz3Tokens(data, layout);
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				giz3ExpandPlaces(drawn.places, layout),
				palette,
				false,
			),
		]);
	},
});
