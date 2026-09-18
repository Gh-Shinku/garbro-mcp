// Format reference: GARbro "ArcFormats/Majiro/ImageRC8.cs", classes `Rc8Format` and `Rc8Format.Reader` (an
// indexed picture of the Majiro engine, held as runs that may reach back into the picture). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The word the reference registers, with the mark `8_00` behind it. */
const SIGNATURE_BYTES = (() => {
	const bytes = Buffer.alloc(4);
	bytes.writeUInt32LE(0x9a925a98);
	return bytes;
})();
const MARK = "8_00";
const PALETTE_OFFSET = 0x14;
const PALETTE_SIZE = 0x300;
const DATA_OFFSET = PALETTE_OFFSET + PALETTE_SIZE;
const MAXIMUM_DIMENSION = 0x8000;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/**
 * `Reader.ShiftTable`: how far behind the picture a run reaches. The low nibble of an entry counts rows and
 * the rest counts places along a row, both as offsets that are subtracted from one another.
 */
const SHIFT_TABLE = new Int8Array([
	-16, -32, -48, -64, 49, 33, 17, 1, -15, -31, -47, 34, 18, 2, -14, -30,
]);

export interface Rc8Layout {
	width: number;
	height: number;
	/** The colour map behind the head, spread over four byte entries as a bitmap wants it. */
	palette: Buffer;
	/** The bytes of the picture, which is a byte a pixel. */
	pixels: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Rc8Format.ReadMetaData`: the word at nought with the mark `8_00` behind it, the width and the height as
 * words from eight, and the depth always reported as eight bits. The colour map of two hundred and fifty six
 * three byte entries stands at `0x14` and the runs behind it.
 */
export function readRc8Layout(
	data: Buffer,
	fileLength = data.length,
): Rc8Layout | undefined {
	if (data.length < DATA_OFFSET) return undefined;
	if (!data.subarray(0, SIGNATURE_BYTES.length).equals(SIGNATURE_BYTES)) {
		return undefined;
	}
	if (data.subarray(4, 8).toString("latin1") !== MARK) return undefined;
	const width = data.readUInt32LE(8);
	const height = data.readUInt32LE(12);
	if (width === 0 || height === 0) return undefined;
	if (width > MAXIMUM_DIMENSION || height > MAXIMUM_DIMENSION) return undefined;
	if (width * height > LIMIT) return undefined;
	if (DATA_OFFSET >= fileLength) return undefined;
	// The colour map is three bytes an entry, which a bitmap holds as four with the fourth left at zero.
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		const at = PALETTE_OFFSET + entry * 3;
		palette[entry * 4] = data[at + 2] ?? 0;
		palette[entry * 4 + 1] = data[at + 1] ?? 0;
		palette[entry * 4 + 2] = data[at] ?? 0;
	}
	return { width, height, palette, pixels: width * height };
}

/**
 * `Reader.Unpack`: the picture is built from runs of two kinds, one after another.
 *
 * A run of the first kind stands itself and holds one byte more than the count the last run left behind,
 * which is nought at the start — a run may therefore say its own length by standing as a byte below `0x80`
 * first, and `0x7F` says that two more bytes hold the rest of the count.
 *
 * A run of the second kind reaches **back** into the picture: the control's high bits choose a place of the
 * shift table, its low three bits hold one less than the length — with seven saying that two more bytes hold
 * the rest — and the place stands behind the picture by the table's own count of rows and places. Every run
 * of the second kind therefore has to reach back, and may not reach before the start or past the end, which
 * the reference refuses as well (a documented deviation in the message only).
 */
export function unpackRc8(stored: Buffer, layout: Rc8Layout): Buffer {
	const picture: Buffer = Buffer.alloc(layout.pixels, 0x00);
	let position = DATA_OFFSET;
	const readByte = (): number => {
		if (position >= stored.length) {
			throw invalidPicture("Majiro picture is cut short of its runs");
		}
		const value = stored[position] ?? 0;
		position += 1;
		return value;
	};
	const readUInt16 = (): number => {
		const low = readByte();
		const high = readByte();
		return (high << 8) | low;
	};
	let dataPos = 0;
	let previous = 0;
	let remaining = layout.pixels;
	while (remaining > 0) {
		let count = previous + 1;
		if (count > remaining) {
			throw invalidPicture("Majiro picture says a run longer than it holds");
		}
		remaining -= count;
		while (count > 0) {
			picture[dataPos] = readByte();
			dataPos += 1;
			count -= 1;
		}
		while (remaining > 0) {
			let control = readByte();
			if (0 === (control & 0x80)) {
				if (0x7f === control) control += readUInt16();
				previous = control;
				break;
			}
			const shiftIndex = control >> 3;
			control &= 7;
			if (7 === control) control += readUInt16();
			count = control + 3;
			if (remaining < count) {
				throw invalidPicture("Majiro picture says a run longer than it holds");
			}
			remaining -= count;
			let shift = SHIFT_TABLE[shiftIndex & 0x0f] ?? 0;
			let rows = shift & 0x0f;
			shift >>= 4;
			rows *= layout.width;
			shift -= rows;
			if (shift >= 0 || dataPos + shift < 0) {
				throw invalidPicture("Majiro picture reaches outside its own runs");
			}
			// `CopyOverlapped` copies a byte at a time, so a run may reach into its own output.
			for (let index = 0; index < count; index += 1) {
				picture[dataPos + index] = picture[dataPos + shift + index] ?? 0;
			}
			dataPos += count;
		}
	}
	return picture;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const majiroRc8ImageDescriptor: FormatDescriptor = {
	id: "majiro-rc8-image",
	name: "Majiro game engine indexed image format",
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
			source: "ArcFormats/Majiro/ImageRC8.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const majiroRc8ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: majiroRc8ImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE_BYTES }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(DATA_OFFSET)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, DATA_OFFSET));
			if (!header.subarray(0, 4).equals(SIGNATURE_BYTES)) return false;
			if (header.subarray(4, 8).toString("latin1") !== MARK) return false;
			const width = header.readUInt32LE(8);
			const height = header.readUInt32LE(12);
			if (width === 0 || height === 0) return false;
			return (
				width <= MAXIMUM_DIMENSION &&
				height <= MAXIMUM_DIMENSION &&
				width * height <= LIMIT
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readRc8Layout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Majiro picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(DATA_OFFSET),
				size: BigInt(layout.pixels),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 8,
				},
			}),
			// The pixels are unfolded from the runs and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "runs",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readRc8Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidPicture("Not a Majiro picture");
		}
		const picture = unpackRc8(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, picture, layout.palette),
		]);
	},
});
