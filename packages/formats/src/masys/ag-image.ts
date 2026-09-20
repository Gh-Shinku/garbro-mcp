// Format reference: GARBro "ArcFormats/Masys/ImageAG.cs", class `AgFormat` along with the `AgReader` and
// the `AgBitStream` it reads through. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'AGd', the format signature. */
const SIGNATURE = Buffer.from("AGd\0", "latin1");
/** The dimensions, then six sections of a stored stream each. */
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
const SECTION_TABLE = 0x0c;
const SECTION_COUNT = 6;
const SECTION_SIZE = 8;
/** The three bytes behind that table are the picture's first pixel. */
const FIRST_PIXEL_FIELD = 0x3c;
const FIRST_PIXEL_SIZE = 3;
const HEADER_SIZE = FIRST_PIXEL_FIELD + FIRST_PIXEL_SIZE;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

/**
 * The streams a pixel is read through. The first says whether the channel is stored as it stands in the
 * fifth; the third says it repeats the pixel before it; the second and the fourth then build it as a
 * difference of at most sixteen from that pixel, the second choosing the direction.
 */
const LITERAL_CONTROL = 0;
const KEEP_CONTROL = 2;
const DELTA_CONTROL = 3;
const DELTA_SIGN = 1;
const LITERAL_BYTES = 4;
/** The sixth stream is the alpha plane, which is run length coded. */
const ALPHA_SECTION = 5;
const RLE_RUN = 0x80;
const RLE_VALUE_MASK = 0x7f;
/** The plane holds six bit samples that the reference scales to eight. */
const ALPHA_MAXIMUM = 0x40;

interface AgSection {
	offset: number;
	size: number;
}

export interface AgLayout {
	width: number;
	height: number;
	/** Whether the picture carries an alpha plane, which is what makes it thirty two bits wide. */
	alpha: boolean;
	/** The six streams, the ones with no size left out. */
	sections: readonly (AgSection | undefined)[];
	firstPixel: readonly number[];
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AgFormat.ReadMetaData` along with the reading half of `AgReader`'s constructor: the dimensions stand at
 * four and eight, and the six sections follow as an offset and a size each. The sixth section's size is
 * what the reference reads as the alpha size, and a picture with no alpha plane is twenty four bits deep.
 * A section with a size that leaves the file, or a size below nothing, is refused here where the reference
 * would hand its stream reader an impossible range.
 */
export function readAgLayout(data: Buffer): AgLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	const sections: (AgSection | undefined)[] = [];
	for (let index = 0; index < SECTION_COUNT; index += 1) {
		const offset = data.readUInt32LE(SECTION_TABLE + index * SECTION_SIZE);
		const size = data.readInt32LE(SECTION_TABLE + index * SECTION_SIZE + 4);
		if (size < 0) return undefined;
		if (0 === size) {
			sections.push(undefined);
			continue;
		}
		if (BigInt(offset) + BigInt(size) > BigInt(data.length)) return undefined;
		sections.push({ offset, size });
	}
	const alpha = sections[ALPHA_SECTION] !== undefined;
	const pixelSize = alpha ? 4 : 3;
	const total = width * height * pixelSize;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	return {
		width,
		height,
		alpha,
		sections,
		firstPixel: [
			data[FIRST_PIXEL_FIELD] ?? 0,
			data[FIRST_PIXEL_FIELD + 1] ?? 0,
			data[FIRST_PIXEL_FIELD + 2] ?? 0,
		],
	};
}

/**
 * `AgBitStream`: the reference keeps a byte with a set bit above it as a marker, so a reader that finds
 * only the marker left loads the next byte. Bits come out of the low end, which is why two nibbles a byte
 * arrive low one first. Where the reference would read into the four bytes of slack it leaves behind its
 * buffer, this port reports the stream as ending instead.
 */
class AgBitStream {
	private src = 0;
	private bits = 1;

	constructor(private readonly input: Buffer) {}

	private nextByte(): number {
		const value = this.input[this.src];
		if (undefined === value) {
			throw invalidImage("A stream of the picture ends before the pixels do");
		}
		this.src += 1;
		return value;
	}

	getBit(): number {
		if (1 === this.bits) this.bits = this.nextByte() | 0x100;
		const bit = this.bits & 1;
		this.bits >>= 1;
		return bit;
	}

	getNibble(): number {
		if (1 === this.bits) this.bits = this.nextByte() | 0x100;
		const nibble = this.bits & 0xf;
		this.bits >>= 4;
		return nibble;
	}

	getByte(): number {
		return this.nextByte();
	}
}

/**
 * `AgReader.RleDecode`: a byte with its high bit set introduces a run of the seven bits that are left and a
 * sixteen bit count behind it; every other byte stands for itself. The reference writes a run past the end
 * of the plane without looking, so a run that does not fit is refused here.
 */
function rleDecode(input: Buffer, length: number): Buffer {
	const output: Buffer = Buffer.alloc(length);
	let src = 0;
	let dst = 0;
	while (dst < length) {
		const value = input[src];
		if (undefined === value) {
			throw invalidImage("The alpha plane ends before it fills the picture");
		}
		src += 1;
		if (0 === (value & RLE_RUN)) {
			output[dst] = value;
			dst += 1;
			continue;
		}
		const low = input[src];
		const high = input[src + 1];
		if (undefined === low || undefined === high) {
			throw invalidImage("The alpha plane ends inside a run");
		}
		src += 2;
		const count = low | (high << 8);
		if (dst + count > length) {
			throw invalidImage("A run of the alpha plane outgrows the picture");
		}
		output.fill(value & RLE_VALUE_MASK, dst, dst + count);
		dst += count;
	}
	return output;
}

/**
 * `AgReader.Unpack`: the pixels run from the top left, and each channel of each one is read through the
 * five control streams. The pixel before it and the first pixel of the row it stands in are what a
 * difference is measured against, so the first pixel of a row carries on from the first pixel of the row
 * before it. The channels are stored blue, green and red, and a difference wraps as a byte does.
 */
export function decodeAg(data: Buffer, layout: AgLayout): Buffer {
	const pixelSize = layout.alpha ? 4 : 3;
	const output: Buffer = Buffer.alloc(layout.width * layout.height * pixelSize);
	// A stream is built the first time a channel asks for it, which is what the reference does by
	// leaving the unused ones unset: a section with no size is only missed when it is read.
	const built = new Map<number, AgBitStream>();
	const stream = (index: number): AgBitStream => {
		const known = built.get(index);
		if (known) return known;
		const section = layout.sections[index];
		if (!section) {
			throw invalidImage("A stream the pixels are read through is missing");
		}
		const created = new AgBitStream(
			data.subarray(section.offset, section.offset + section.size),
		);
		built.set(index, created);
		return created;
	};
	const first = [...layout.firstPixel];

	// Each stream is asked for where the reference asks its own, so a section the picture never reads is
	// allowed to be missing.
	const readColor = (channel: number): number => {
		if (0 !== stream(LITERAL_CONTROL).getBit()) {
			return stream(LITERAL_BYTES).getByte();
		}
		if (0 !== stream(KEEP_CONTROL).getBit()) return first[channel] ?? 0;
		const distance = stream(DELTA_CONTROL).getNibble() + 1;
		if (0 !== stream(DELTA_SIGN).getBit()) {
			return ((first[channel] ?? 0) - distance) & 0xff;
		}
		return ((first[channel] ?? 0) + distance) & 0xff;
	};

	let dst = 0;
	for (let y = 0; y < layout.height; y += 1) {
		const row = dst;
		for (let x = 0; x < layout.width; x += 1) {
			const blue = readColor(0);
			const green = readColor(1);
			const red = readColor(2);
			output[dst] = blue;
			output[dst + 1] = green;
			output[dst + 2] = red;
			first[0] = blue;
			first[1] = green;
			first[2] = red;
			dst += pixelSize;
		}
		// The row that has just been read seeds the next one with its own first pixel.
		first[0] = output[row] ?? 0;
		first[1] = output[row + 1] ?? 0;
		first[2] = output[row + 2] ?? 0;
	}
	if (layout.alpha) {
		const section = layout.sections[ALPHA_SECTION];
		if (!section) throw invalidImage("The alpha plane is missing");
		const plane = rleDecode(
			data.subarray(section.offset, section.offset + section.size),
			layout.width * layout.height,
		);
		for (let index = 3, sample = 0; index < output.length; index += 4) {
			const scaled = Math.floor(((plane[sample] ?? 0) * 0xff) / ALPHA_MAXIMUM);
			output[index] = Math.min(scaled, 0xff);
			sample += 1;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const masysAgImageDescriptor: FormatDescriptor = {
	id: "masys-ag-image",
	name: "Masys image",
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
			source: "ArcFormats/Masys/ImageAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const masysAgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: masysAgImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readAgLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readAgLayout(stored);
		if (!layout) {
			throw invalidImage("Not a Masys picture");
		}
		const bitsPerPixel = layout.alpha ? 32 : 24;
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
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
					bitsPerPixel,
				},
			}),
			// The streams are reserialised as a bitmap, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel,
				alpha: layout.alpha,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAgLayout(stored);
		if (!layout) {
			throw invalidImage("Not a Masys picture");
		}
		const pixels = decodeAg(stored, layout);
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([
			layout.alpha
				? writeBmp32(layout.width, layout.height, pixels, false)
				: writeBmp24(layout.width, layout.height, pixels, false),
		]);
	},
});
