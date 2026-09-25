// Format reference: GARBro "Legacy/Miami/ImageMIA.cs", class `MiaFormat` with the `MiaReader` beside it.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("CoB42", "latin1");
const MARK_FIELD = 0xa;
const HEAD_SIZE = 0x10;
const WIDTH_FIELD = 6;
const HEIGHT_FIELD = 8;
const BITS_PER_PLACE = 4;
const PLACES_PER_BYTE = 2;
const PALETTE_PLACES = 16;
const PALETTE_PLACE_SIZE = 3;
const PALETTE_SIZE = PALETTE_PLACES * PALETTE_PLACE_SIZE;
const PLACE_STEP = 0x11;
const BITMAP_PLACES = 0x100;
/** The places of a picture stand in a frame of its own, of eight bytes to a group of four places. */
const GROUP_SIZE = 8;
const PLACES_PER_GROUP = 4;
const ROW_GROUP_SIZE = 0x10;
const ROW_PLACES = 8;
const PATTERN_PLACES = 0x10;
const PATTERN_ROWS = 0x11;
const PATTERN_SIZE = PATTERN_ROWS * PATTERN_PLACES;
const FIRST_PLACE = 0x10;
const MAX_GROUPS = 5;
const ORDER_SIZE = 6;
const LIMIT = 256 * 1024 * 1024;

export interface MiaLayout {
	width: number;
	height: number;
}

export interface MiaPicture {
	places: Buffer;
	palette: Buffer;
	width: number;
	height: number;
}

/** A word of the picture standing short of what the walk of it asks for. */
class MiaEndOfStream extends Error {}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `MiaFormat.ReadMetaData`: the picture opens with its own word far behind its head. */
export function readMiaLayout(data: Buffer): MiaLayout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (
		data.toString("latin1", MARK_FIELD, MARK_FIELD + MARK.length) !==
		MARK.toString("latin1")
	) {
		return undefined;
	}
	const width = data.readUInt16LE(WIDTH_FIELD);
	const height = data.readUInt16LE(HEIGHT_FIELD);
	if (0 === width || 0 === height || width * height > LIMIT) return undefined;
	return { width, height };
}

/** The colour map of a picture, green, red and blue to a colour, every byte spread over the whole of it. */
export function readMiaPalette(data: Buffer, offset: number): Buffer {
	const palette = Buffer.alloc(BITMAP_PLACES * 4, 0x00);
	for (let at = 0; at < PALETTE_PLACES; at += 1) {
		const base = offset + at * PALETTE_PLACE_SIZE;
		const g = data[base] ?? 0;
		const r = data[base + 1] ?? 0;
		const b = data[base + 2] ?? 0;
		palette[at * 4] = (b * PLACE_STEP) & 0xff;
		palette[at * 4 + 1] = (g * PLACE_STEP) & 0xff;
		palette[at * 4 + 2] = (r * PLACE_STEP) & 0xff;
	}
	return palette;
}

/** `MiaReader.SetupPattern`: the places a picture of this engine draws its own colours out of. */
function setupPattern(): Buffer {
	const pattern = Buffer.alloc(PATTERN_SIZE, 0x00);
	let at = 0;
	for (let high = 0; high < PATTERN_ROWS; high += 1) {
		for (let low = 0; low < PATTERN_PLACES; low += 1) {
			pattern[at] = (high + low) & 0xf;
			at += 1;
		}
	}
	return pattern;
}

/** The bits of a picture, of which the lowest of a byte stands first. */
class MiaBits {
	private readonly data: Buffer;
	private position: number;
	private byte = 0;
	private left = 0;

	constructor(data: Buffer, position: number) {
		this.data = data;
		this.position = position;
	}

	private nextBit(): number {
		if (this.left <= 0) {
			if (this.position >= this.data.length) throw new MiaEndOfStream();
			this.byte = this.data[this.position] ?? 0;
			this.position += 1;
			this.left = 8;
		}
		const bit = this.byte & 1;
		this.byte >>= 1;
		this.left -= 1;
		return bit;
	}

	/** `MiaReader.GetInt`: how many bits stand clear in front of the next one that stands. */
	count(): number {
		let count = 0;
		while (0 === this.nextBit()) count += 1;
		return count;
	}
}

/**
 * `MiaReader.UnpackInternal`: a picture of this engine is drawn a group of four places at a time, out of a
 * frame of its own; the frame stands of eight bytes to a group and is handed to the picture once it is full.
 */
export function unpackMiaPicture(data: Buffer, layout: MiaLayout): MiaPicture {
	const stride = layout.width >> 1;
	const output = Buffer.alloc(stride * layout.height, 0x00);
	const buffer = Buffer.alloc(layout.height * ROW_GROUP_SIZE, 0x00);
	const pattern = setupPattern();
	// The order of the ways of a picture stands in front of the bits of its places.
	const bits = new MiaBits(data, HEAD_SIZE + PALETTE_SIZE + ORDER_SIZE);
	const order = Buffer.from(
		data.subarray(
			HEAD_SIZE + PALETTE_SIZE,
			HEAD_SIZE + PALETTE_SIZE + ORDER_SIZE,
		),
	);
	let outputAt = 0;
	let bufferAt = 0;

	const flush = (): void => {
		const height = layout.height;
		const half = height * GROUP_SIZE;
		let source = 0;
		let dst = outputAt;
		for (let row = 0; row < height; row += 1) {
			const planes: number[] = [];
			for (let plane = 0; plane < BITS_PER_PLACE; plane += 1) {
				planes.push(
					(buffer[source + PLACES_PER_GROUP + plane] ?? 0) |
						(buffer[source + half + plane] ?? 0),
				);
			}
			for (let j = 0; j < ROW_PLACES; j += PLACES_PER_BYTE) {
				let place = 0;
				let low = 0;
				for (let plane = 0; plane < BITS_PER_PLACE; plane += 1) {
					const packed = planes[plane] ?? 0;
					place |= ((packed << j) & 0x80) >>> (3 - plane);
					low |= ((packed << j) & 0x40) >>> (6 - plane);
				}
				output[dst + (j >> 1)] = (place | low) & 0xff;
			}
			source += GROUP_SIZE;
			dst += stride;
		}
		outputAt += PLACES_PER_GROUP;
		bufferAt = 0;
	};

	const copyGroups = (count: number, offset: number): void => {
		let left = count;
		while (left > 0) {
			const dst = bufferAt;
			if (dst < offset) {
				let take = left;
				const room = (offset - dst) >> 3;
				if (take > room) take = room;
				left -= take;
				const source = dst + buffer.length - offset;
				const bytes = take << 3;
				for (let at = 0; at < bytes; at += 1) {
					buffer[bufferAt + at] = buffer[(source + at) % buffer.length] ?? 0;
				}
				bufferAt += bytes;
				if (0 === left) return;
			}
			let take = left;
			const room = (buffer.length - bufferAt) >> 3;
			if (take > room) take = room;
			left -= take;
			const bytes = take << 3;
			for (let at = 0; at < bytes; at += 1) {
				buffer[bufferAt + at] = buffer[bufferAt - offset + at] ?? 0;
			}
			bufferAt += bytes;
			if (buffer.length === bufferAt) flush();
		}
	};

	/** `MiaReader.CopyOp05`: the group behind the walk, of its places turned about two by two. */
	const copySwap = (count: number): void => {
		let source = bufferAt - GROUP_SIZE;
		if (source < 0) source = buffer.length - GROUP_SIZE;
		for (let half = 0; half < 2; half += 1) {
			for (let pair = 0; pair < 2; pair += 1) {
				const at = source + pair * 2;
				const word = buffer.readUInt16LE(at);
				const swapped =
					(((word << 1) & 0x0a0a) | ((word >>> 1) & 0x0505)) & 0xffff;
				const low = swapped & 0xff;
				const high = (swapped >>> 8) & 0xff;
				buffer[bufferAt + half * 4 + pair * 2] = low;
				buffer[bufferAt + half * 4 + pair * 2 + 1] = high;
				buffer[bufferAt + half * 4 + 4 + pair * 2] = (low << 4) & 0xff;
				buffer[bufferAt + half * 4 + 4 + pair * 2 + 1] = (high << 4) & 0xff;
			}
		}
		bufferAt += GROUP_SIZE;
		if (buffer.length === bufferAt) flush();
		if (0 !== --count) copyGroups(count, ROW_GROUP_SIZE);
	};

	let previous = FIRST_PLACE;
	try {
		while (outputAt < stride) {
			const control = bits.count() - 1;
			if (control < 0) {
				// The places of a group, every one of them a place of the pattern of its own.
				for (let at = 0; at < PLACES_PER_GROUP; at += 1) {
					buffer[bufferAt + at] = 0x00;
				}
				for (let place = 0; place < PLACES_PER_GROUP; place += 1) {
					const count = bits.count();
					let dst = count + (previous << 4);
					if (dst >= PATTERN_SIZE) {
						throw invalidPicture(
							"A place of the picture stands outside its pattern",
						);
					}
					const value = pattern[dst] ?? 0;
					let source = dst - 1;
					for (let left = count; left > 0; left -= 1) {
						if (dst > 0) pattern[dst] = pattern[source] ?? 0;
						dst -= 1;
						source -= 1;
					}
					pattern[dst] = value;
					previous = value;
					let drawn = value;
					for (let plane = 0; plane < PLACES_PER_GROUP; plane += 1) {
						buffer[bufferAt + plane] =
							(((buffer[bufferAt + plane] ?? 0) << 1) | (drawn & 1)) & 0xff;
						drawn >>= 1;
					}
				}
				const first = buffer.readUInt16LE(bufferAt);
				const second = buffer.readUInt16LE(bufferAt + 2);
				buffer.writeUInt16LE((first << 4) & 0xffff, bufferAt + 4);
				buffer.writeUInt16LE((second << 4) & 0xffff, bufferAt + 6);
				bufferAt += GROUP_SIZE;
			} else if (control < MAX_GROUPS) {
				const count = 1 + bits.count();
				switch (order[control] ?? 0) {
					case 1:
						copyGroups(count, GROUP_SIZE);
						break;
					case 2:
						copyGroups(count, ROW_GROUP_SIZE);
						break;
					case 3:
						copyGroups(count, 2 * ROW_GROUP_SIZE);
						break;
					case 4:
						copyGroups(count, layout.height * GROUP_SIZE);
						break;
					case 5:
						copySwap(count);
						break;
					default:
						throw invalidPicture(
							"The picture names a way of its own this project does not read",
						);
				}
			} else {
				throw invalidPicture(
					"The picture names a way of its own this project does not read",
				);
			}
			if (buffer.length === bufferAt) flush();
		}
	} catch (error) {
		// A picture whose bits stand short is handed over as far as it was drawn, as the reference hands it.
		if (!(error instanceof MiaEndOfStream)) throw error;
		flush();
	}
	return {
		places: output,
		palette: readMiaPalette(data, HEAD_SIZE),
		width: layout.width,
		height: layout.height,
	};
}

/** The places of a picture, one byte to a place, for a bitmap that holds a byte to a place. */
export function miaExpandPlaces(picture: MiaPicture): Buffer {
	const stride = picture.width >> 1;
	const output = Buffer.alloc(picture.width * picture.height, 0x00);
	for (let row = 0; row < picture.height; row += 1) {
		for (let at = 0; at < stride; at += 1) {
			const packed = picture.places[row * stride + at] ?? 0;
			const column = at * PLACES_PER_BYTE;
			output[row * picture.width + column] = packed >> 4;
			if (column + 1 < picture.width) {
				output[row * picture.width + column + 1] = packed & 0x0f;
			}
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const miaImageDescriptor: FormatDescriptor = {
	id: "miami-mia-image",
	name: "Miamisoft image",
	extensions: [""],
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
			source: "Legacy/Miami/ImageMIA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const miaImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: miaImageDescriptor,
	// The picture writes no word of its own: it is told by the shape of its head, which names its own format.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		return readMiaLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMiaLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Miamisoft engine");
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
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMiaLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Miamisoft engine");
		const picture = unpackMiaPicture(data, layout);
		return Readable.from([
			writeBmp8Palette(
				picture.width,
				picture.height,
				miaExpandPlaces(picture),
				picture.palette,
				false,
			),
		]);
	},
});
