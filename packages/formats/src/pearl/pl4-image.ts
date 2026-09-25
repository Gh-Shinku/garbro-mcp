// Port of GARbro "Legacy/Pearl/ImagePL4.cs" (tag "PL4", classes Pl4Format, Pl4Reader), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
// A PL4 picture is a colour map of sixteen colours and the pixels of four places to a place, of two kinds
// of walks over them.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8Palette } from "../shared/bmp.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const MARK = Buffer.from("PL4 ", "latin1");
const HEAD_SIZE = 0x10;
const PALETTE_AT = 0x10;
const PALETTE_COLORS = 16;
const DATA_AT = 0x40;
/** The byte that opens a run of the places of a picture the walks of the first kind stand of. */
const RUN_MARK = 0x98;
const PALETTE_ENTRIES = 0x100;

export interface Pl4Layout {
	width: number;
	height: number;
	compression: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `Pl4Format.ReadMetaData`. */
export function readPl4Layout(data: Buffer): Pl4Layout | undefined {
	if (data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, MARK.length).equals(MARK)) return undefined;
	if (1 !== data.readUInt16LE(4)) return undefined;
	const compression = data.readUInt16LE(6);
	if (compression > 1) return undefined;
	const width = data.readUInt16LE(0xc) * 8;
	const height = data.readUInt16LE(0xe);
	if (0 === width || 0 === height) return undefined;
	return { width, height, compression };
}

/** `Pl4Reader.ReadPalette`: sixteen colours of three places, every one of them of sixteen steps. */
function readPl4Palette(data: Buffer): Buffer {
	if (data.length < PALETTE_AT + PALETTE_COLORS * 3) {
		throw invalidPicture("The colours of the picture stand short of the file");
	}
	const palette: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let at = 0; at < PALETTE_COLORS; at += 1) {
		const red = data[PALETTE_AT + at * 3] ?? 0;
		const green = data[PALETTE_AT + at * 3 + 1] ?? 0;
		const blue = data[PALETTE_AT + at * 3 + 2] ?? 0;
		palette[at * 4] = (blue * 0x11) & 0xff;
		palette[at * 4 + 1] = (green * 0x11) & 0xff;
		palette[at * 4 + 2] = (red * 0x11) & 0xff;
	}
	return palette;
}

/** The four places of a word of the walks of the first kind, of the places of the file. */
function placesOfWord(word: number): number[] {
	const places: number[] = [];
	for (let place = 0; place < 4; place += 1) {
		let pixel = 0;
		for (let bit = 0; bit < 4; bit += 1) {
			pixel |= ((word >> (15 - place - 4 * bit)) & 1) << bit;
		}
		places.push(pixel);
	}
	return places;
}

/** `Pl4Reader.UnpackV0`: the walks of the first kind. */
function unpackV0(data: Buffer, layout: Pl4Layout, output: Buffer): void {
	const { width, height } = layout;
	const stride = width;
	const outputSize = stride * height;
	let groups = width / 4;
	let row = 0;
	let destination = 0;
	let at = DATA_AT;
	while (at < data.length) {
		let control = data[at] ?? 0;
		at += 1;
		let next = data[at] ?? 0;
		at += 1;
		if (RUN_MARK === control) {
			control = data[at] ?? 0;
			at += 1;
			if (0 === next) {
				next = data[at] ?? 0;
				at += 1;
			} else {
				const word = ((control << 8) | next) & 0xffff;
				let count = ((word >> 1) & 0x1f) + 2;
				const mixed = (word >> 6) + 1;
				const sourceColumn = Math.floor(mixed / height);
				let sourceRow = mixed % height;
				let source = destination - sourceRow * stride - 4 * sourceColumn;
				sourceRow = row - sourceRow;
				if (sourceRow < 0) {
					sourceRow += height;
					source += outputSize - 4;
				}
				while (count > 0) {
					count -= 1;
					for (let place = 0; place < 4; place += 1) {
						output[destination + place] = output[source + place] ?? 0;
					}
					destination += stride;
					row += 1;
					if (row >= height) {
						row = 0;
						destination -= outputSize - 4;
						groups -= 1;
						if (groups <= 0) return;
					}
					source += stride;
					sourceRow += 1;
					if (sourceRow >= height) {
						sourceRow = 0;
						source -= outputSize - 4;
					}
				}
				continue;
			}
		}
		const word = ((next << 8) | control) & 0xffff;
		const places = placesOfWord(word);
		for (let place = 0; place < 4; place += 1) {
			output[destination + place] = places[place] ?? 0;
		}
		destination += stride;
		row += 1;
		if (row >= height) {
			row = 0;
			destination -= outputSize - 4;
			groups -= 1;
			if (groups <= 0) break;
		}
	}
}

/** `Pl4Reader.UnpackV1`: the walks of the second kind, of a table of the places behind them. */
function unpackV1(data: Buffer, layout: Pl4Layout, output: Buffer): void {
	const { width, height } = layout;
	const stride = width;
	const outputSize = stride * height;
	const table = new Uint8Array(0x100);
	for (let at = 0; at < table.length; at += 1) {
		table[at] = (at + (at >> 4)) & 0xf;
	}
	const bits = new MsbBitReader(data, DATA_AT);

	/** `Pl4Reader.GetPixelBits`: the place in the table the walk of the bits names. */
	const readPosition = (): number => {
		const first = bits.tryReadBits(1);
		// The walks of the picture stand short of the file: the reference would read the places of the
		// table behind them as the places of a walk of its own.
		if (first < 0)
			throw invalidPicture("The walks of the picture stand short of the file");
		if (1 === first) return bits.tryReadBits(1);
		if (1 === bits.tryReadBits(1)) return (bits.tryReadBits(1) ?? 0) + 2;
		if (1 === bits.tryReadBits(1)) {
			return (bits.tryReadBits(2) ?? 0) + 4;
		}
		return (bits.tryReadBits(3) ?? 0) + 8;
	};

	/** `Pl4Reader.GetNextPixel`: the place of the table, standing in front of the places of it. */
	const readPixel = (prior: number): number => {
		let position = readPosition();
		if (position < 0)
			throw invalidPicture("The walks of the picture stand short of the file");
		const row = (prior & 0xf) << 4;
		const value = table[row + position] ?? 0;
		let at = row + position;
		while (position > 0) {
			table[at] = table[at - 1] ?? 0;
			at -= 1;
			position -= 1;
		}
		table[row] = value;
		return value;
	};

	let groups = width / 8;
	let row = 0;
	let destination = 0;
	const states = [0, 0, 0, 0];
	for (;;) {
		const control = bits.tryReadBits(1);
		if (control < 0) break;
		if (0 !== control) {
			let source = destination;
			let sourceRow = row;
			switch (bits.tryReadBits(2)) {
				case 0:
					sourceRow = row - 2;
					source = destination - 2 * stride;
					break;
				case 1:
					sourceRow = row - 1;
					source = destination - stride;
					break;
				case 2:
					sourceRow = row - 4;
					source = destination - 4 * stride;
					break;
				default:
					source = destination - 8;
					break;
			}
			if (sourceRow < 0) {
				sourceRow += height;
				source += outputSize - 8;
			}
			let countLength = 0;
			while (0 === bits.tryReadBits(1)) countLength += 1;
			let count = 1;
			if (0 !== countLength) {
				count = (bits.tryReadBits(countLength) ?? 0) | (1 << countLength);
			}
			while (count > 0) {
				count -= 1;
				output.copy(output, destination, source, source + 8);
				destination += stride;
				row += 1;
				if (row >= height) {
					row = 0;
					destination -= outputSize - 8;
					groups -= 1;
					if (groups <= 0) return;
				}
				source += stride;
				sourceRow += 1;
				if (sourceRow >= height) {
					sourceRow = 0;
					source -= outputSize - 8;
				}
			}
			continue;
		}
		for (let state = 0; state < 4; state += 1) {
			const first = readPixel(states[state] ?? 0);
			const second = readPixel(first);
			states[state] = (first << 4) | second;
		}
		for (let state = 0; state < 4; state += 1) {
			const value = states[state] ?? 0;
			const high = (value >> 4) & 0xf;
			const low = value & 0xf;
			for (let place = 0; place < 4; place += 1) {
				output[destination + place] =
					(output[destination + place] ?? 0) |
					(((high >> (3 - place)) & 1) << state);
				output[destination + 4 + place] =
					(output[destination + 4 + place] ?? 0) |
					(((low >> (3 - place)) & 1) << state);
			}
		}
		destination += stride;
		row += 1;
		if (row >= height) {
			row = 0;
			destination -= outputSize - 8;
			groups -= 1;
			if (groups <= 0) break;
		}
	}
}

/** `Pl4Reader.Unpack`: the places of the picture and the colour map of it behind them. */
export function unpackPl4Picture(data: Buffer, layout: Pl4Layout): Buffer {
	const palette = readPl4Palette(data);
	const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	if (0 === layout.compression) {
		unpackV0(data, layout, output);
	} else {
		unpackV1(data, layout, output);
	}
	return writeBmp8Palette(layout.width, layout.height, output, palette);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const pearlPl4ImageDescriptor: FormatDescriptor = {
	id: "pearl-pl4-image",
	name: "Pearl Soft image",
	extensions: ["pl4"],
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
			source: "Legacy/Pearl/ImagePL4.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pearlPl4ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pearlPl4ImageDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			return readPl4Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const layout = readPl4Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Pearl Soft engine");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: "image.bmp",
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
					compression: layout.compression,
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
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readPl4Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the Pearl Soft engine");
		return Readable.from([unpackPl4Picture(data, layout)]);
	},
});
