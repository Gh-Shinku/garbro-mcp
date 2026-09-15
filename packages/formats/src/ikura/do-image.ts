// Format reference: GARbro "ArcFormats/Ikura/ImageVRS.cs", classes `DoFormat` and `DoReader` (the D.O. picture
// of the Ikura engine). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
} from "../shared/fixed-archive.js";

/** The two letters the reference signs this format with. */
const SIGNATURE = Buffer.from("DO", "latin1");
/** The header: the two letters, two bytes of nothing and the measurements. */
const HEADER_SIZE = 12;
/** A colour map of two hundred and fifty six entries of three bytes each. */
const PALETTE_SIZE = 0x300;
const PIXEL_OFFSET = HEADER_SIZE + PALETTE_SIZE;
const PALETTE_ENTRIES = 0x100;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface DoLayout {
	width: number;
	height: number;
	/** The colour map as a bitmap wants it: four bytes an entry, blue first. */
	palette: Buffer;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `DoReader.ReadPalette`: two hundred and fifty six entries of three bytes, which the reference reads as
 * red, green and blue from the second, third and first byte of each — so the colour map of the file stands
 * blue, red, green. A file whose colour map is not all there is refused, which is the reference's own length
 * check. The entries are turned into the four bytes a bitmap wants, whose order is blue, green, red, nothing.
 */
function readDoPalette(data: Buffer, offset: number): Buffer {
	const entries: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const source = offset + index * 3;
		entries[index * 4] = data[source] ?? 0;
		entries[index * 4 + 1] = data[source + 2] ?? 0;
		entries[index * 4 + 2] = data[source + 1] ?? 0;
	}
	return entries;
}

/**
 * `DoFormat.ReadMetaData`: the two letters, two bytes of nothing and the measurements, with the colour map
 * behind them. The depth is always reported as eight bits. A picture of no width or height is turned away.
 */
export function readDoLayout(data: Buffer): DoLayout | undefined {
	if (data.length < PIXEL_OFFSET) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt16LE(4);
	const height = data.readUInt16LE(6);
	if (0 === width || 0 === height) return undefined;
	return { width, height, palette: readDoPalette(data, HEADER_SIZE) };
}

/**
 * `DoReader.Unpack`: the pixels stand behind the colour map, and the stream behind them is a walk of three
 * kinds of run. A control byte with its two highest bits clear holds that many pixels themselves, of which a
 * count of nothing means the byte behind it plus `0x40`. A control byte with only its highest bit clear holds
 * that many repeats of the pixel before it, again with a count of nothing standing for the byte behind it
 * plus `0x40`, and one more than either says. A control byte with its highest bit standing holds a run copied
 * from a place behind the one it stands at — the low nibble of the control byte holds the top of that place —
 * of which the count stands in the three bits behind the control byte, or in the byte behind it plus eight
 * when those are nothing, and always two more than either says. A copy may read what it has just written,
 * which is what makes a repeat of the pixel before it and a copy of a longer run work.
 *
 * The reference reads the pixels of a run of the first kind from the stream, so one that stops early leaves
 * the rest of those pixels as they stand and the walk carries on; a walk that reaches outside the picture is
 * refused, as is a stream that stops where a control byte is wanted, both where the reference's .NET reader
 * would throw (documented deviations in the message only). A picture whose pixels would take more than 256
 * megabytes is refused rather than allocated.
 */
export function unpackDo(data: Buffer, layout: DoLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	let position = PIXEL_OFFSET;
	const readByte = (): number => {
		if (position >= data.length) {
			throw invalidPicture("D.O. picture is cut short of its stream");
		}
		const value = data[position] ?? 0;
		position += 1;
		return value;
	};
	let dst = 0;
	while (dst < output.length) {
		const control = readByte();
		let count: number;
		if (0 === (control & 0xc0)) {
			count = control & 0x3f;
			if (0 === count) count = readByte() + 0x40;
			if (dst + count > output.length) {
				throw invalidPicture("D.O. picture writes past its own end");
			}
			const end = Math.min(position + count, data.length);
			if (end > position) {
				data.copy(output, dst, position, end);
			}
			position = end;
		} else if (0 === (control & 0x80)) {
			count = control & 0x3f;
			if (0 === count) count = readByte() + 0x40;
			count += 1;
			if (dst < 1 || dst + count > output.length) {
				throw invalidPicture("D.O. picture writes past its own end");
			}
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = output[dst + index - 1] ?? 0;
			}
		} else {
			const offset = (readByte() | ((control & 0x0f) << 8)) + 1;
			count = (control >> 4) & 0x07;
			if (0 === count) count = readByte() + 8;
			count += 2;
			if (dst - offset < 0 || dst + count > output.length) {
				throw invalidPicture("D.O. picture writes past its own end");
			}
			for (let index = 0; index < count; index += 1) {
				output[dst + index] = output[dst + index - offset] ?? 0;
			}
		}
		dst += count;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ikuraDoImageDescriptor: FormatDescriptor = {
	id: "ikura-vrs-do-image",
	name: "D.O. image format",
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
			source: "ArcFormats/Ikura/ImageVRS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikuraDoImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikuraDoImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(PIXEL_OFFSET)) return false;
		return readDoLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDoLayout(await readStored(source));
		if (!layout) {
			throw invalidPicture("Not a D.O. picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "bmp"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: {
							type: "image",
							width: layout.width,
							height: layout.height,
							bitsPerPixel: 8,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				image: "bmp",
				compression: "lzss",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readDoLayout(stored);
		if (!layout) {
			throw invalidPicture("Not a D.O. picture");
		}
		const size = layout.width * layout.height;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`D.O. picture of ${size} bytes is too large`,
			);
		}
		// The colour map of the picture is the one it brought along, and the walk is top down, which a bitmap
		// records as a negative height.
		const pixels = unpackDo(stored, layout);
		return Readable.from([
			writeBmp8Palette(
				layout.width,
				layout.height,
				pixels,
				layout.palette,
				false,
			),
		]);
	},
});
