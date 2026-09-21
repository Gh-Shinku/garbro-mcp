// Format reference: GARBro "ArcFormats/TechnoBrain/ImageIPF.cs", class `IpfFormat` with the `IpfReader` that
// unpacks through it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/**
 * The file opens with `RIFF`, which the reference deliberately leaves out of its signature so that it is not
 * offered every wave file as well: what tells an IPF apart is the `fmt ` chunk at 0x0C and the string that
 * chunk carries.
 */
const SIGNATURE = Buffer.from("RIFF", "latin1");
const FORMAT_TAG_FIELD = 0x0c;
const FORMAT_SIZE_FIELD = 0x10;
const FORMAT_NAME_FIELD = 0x1c;
const FORMAT_NAME_SIZE = 8;
const FORMAT_NAME = "IPF fmt ";
const FORMAT_CHUNK_MINIMUM = 0x24;
/**
 * Where the chunks behind the format chunk begin. The reference reads the first twenty bytes of the file and
 * then reads `0x14 + fmt_size` more from there, which leaves its stream twenty bytes past the end of the
 * chunk itself; the palette and the bitmap are found at the place that lands on, so the port keeps it.
 */
const FORMAT_BODY_END = 0x28;
/** What the format chunk says the file carries, at the places the reference reads it from. */
const PALETTE_FLAG_FIELD = 0x2c;
const BITMAP_FLAG_FIELD = 0x3c;
/** The palette chunk: a tag, a size, then four bytes the reference steps over and a bitmap of which of the
 * two hundred and fifty six colours are stored. */
const PALETTE_TAG = "pal ";
const PALETTE_SIZE_MINIMUM = 0x24;
const PALETTE_SKIP = 4;
const PALETTE_PRESENCE = 0x20;
const PALETTE_ENTRY = 3;
/** The colours the reference refuses to name: the first ten and the last nine. */
const PALETTE_FIRST = 0x0a;
const PALETTE_LAST = 0xf6;
/** The bitmap chunk: a tag, a size, and then the fields behind a header of this length. */
const BITMAP_TAG = "bmp ";
const BITMAP_SIZE_MINIMUM = 0x1c;
/** The fields run from the size: the dimensions, a word, the two places, six bytes, then the flags. */
const BITMAP_FLAGS = 0x1a;
/** The pixels stand behind a header of this length. */
const BITMAP_BODY = 0x20;
const BITMAP_COMPRESSED_FLAG = 1;
/** The control bytes of the packed bitmap. */
const CONTROL_END = 0x0f;
const CONTROL_ESCAPE = 0x0e;
const CONTROL_FILL = 0x10;
const CONTROL_COPY = 0x20;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface IpfLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	hasPalette: boolean;
	compressed: boolean;
	paletteOffset: number;
	paletteSize: number;
	bitmapOffset: number;
	offsetX: number;
	offsetY: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `IpfFormat.ReadIpfHeader` along with `ReadBmpInfo`: the format chunk at 0x0C carries the string the file is
 * recognised by, and the flag that says a palette chunk follows; the bitmap chunk behind that carries the
 * dimensions, the place the picture hangs at and whether its pixels are packed.
 */
export function readIpfLayout(data: Buffer): IpfLayout | undefined {
	if (data.length < FORMAT_TAG_FIELD + 8) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString("latin1", FORMAT_TAG_FIELD, FORMAT_TAG_FIELD + 4) !== "fmt "
	)
		return undefined;
	const formatSize = data.readInt32LE(FORMAT_SIZE_FIELD);
	if (formatSize < FORMAT_CHUNK_MINIMUM) return undefined;
	const formatEnd = FORMAT_BODY_END + formatSize;
	if (formatEnd > data.length) return undefined;
	if (data.length < BITMAP_FLAG_FIELD + 4) return undefined;
	if (
		data.toString(
			"latin1",
			FORMAT_NAME_FIELD,
			FORMAT_NAME_FIELD + FORMAT_NAME_SIZE,
		) !== FORMAT_NAME
	) {
		return undefined;
	}
	if (0 === data.readInt32LE(BITMAP_FLAG_FIELD)) return undefined;
	const hasPalette = 0 !== data.readInt32LE(PALETTE_FLAG_FIELD);

	let position = formatEnd;
	let paletteOffset = 0;
	let paletteSize = 0;
	if (hasPalette) {
		if (position + 8 > data.length) return undefined;
		if (data.toString("latin1", position, position + 4) !== PALETTE_TAG) {
			return undefined;
		}
		paletteSize = data.readInt32LE(position + 4);
		if (paletteSize < PALETTE_SIZE_MINIMUM) return undefined;
		paletteOffset = position + 8;
		if (paletteOffset + paletteSize > data.length) return undefined;
		position = paletteOffset + paletteSize;
	}
	if (position + 8 > data.length) return undefined;
	if (data.toString("latin1", position, position + 4) !== BITMAP_TAG) {
		return undefined;
	}
	const bitmapSize = data.readInt32LE(position + 4);
	if (bitmapSize < BITMAP_SIZE_MINIMUM) return undefined;
	if (position + BITMAP_FLAGS + 1 > data.length) return undefined;
	const width = data.readUInt16LE(position + 8);
	const height = data.readUInt16LE(position + 10);
	if (0 === width || 0 === height) return undefined;
	const total = width * height;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	return {
		width,
		height,
		bitsPerPixel: 8,
		hasPalette,
		compressed:
			0 !== ((data[position + BITMAP_FLAGS] ?? 0) & BITMAP_COMPRESSED_FLAG),
		paletteOffset,
		paletteSize,
		bitmapOffset: position + BITMAP_BODY,
		offsetX: data.readInt16LE(position + 16),
		offsetY: data.readInt16LE(position + 18),
	};
}

/**
 * `IpfReader.UnpackPalette`: a byte to each eight colours says whether that colour is stored, the highest bit
 * first, and every colour that is stored takes three bytes of red, green and blue. The first ten and the last
 * nine colours are never stored, and every colour the file does not carry stands as black. A stored colour
 * beyond the last one still takes its three bytes, which is how the reference walks the data.
 */
function unpackIpfPalette(data: Buffer, layout: IpfLayout): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	const presence = layout.paletteOffset + PALETTE_SKIP;
	if (presence + PALETTE_PRESENCE > data.length) {
		throw invalidImage("The palette of the picture is cut short");
	}
	let source = presence + PALETTE_PRESENCE;
	for (let index = 0; index < 0x20; index += 1) {
		let bits = data[presence + index] ?? 0;
		for (let bit = 0; bit < 8; bit += 1) {
			const colour = (index << 3) + bit;
			if (colour >= PALETTE_FIRST && 0 !== (bits & 0x80)) {
				if (colour <= PALETTE_LAST) {
					if (source + PALETTE_ENTRY > data.length) {
						throw invalidImage("The colours of the picture are cut short");
					}
					// A bitmap stores its palette blue first; the file keeps red first.
					palette[colour * 4] = data[source + 2] ?? 0;
					palette[colour * 4 + 1] = data[source + 1] ?? 0;
					palette[colour * 4 + 2] = data[source] ?? 0;
				}
				source += PALETTE_ENTRY;
			}
			bits <<= 1;
		}
	}
	return palette;
}

/**
 * `IpfReader.UnpackBitmap`, the walk the reference calls `IPF_12`: a byte of nothing but ones ends the
 * picture and leaves the rest of it as it stands; the escape byte stands for itself; a byte below 0x10
 * introduces a run of one byte, whose length is twelve bits wide and one longer than the number written; a
 * byte below 0x20 introduces a copy of two to eight bytes from one to four thousand and ninety six back; and
 * anything else stands for itself, sixteen below its own value. The reference writes past the end of a run
 * without looking, so a run that does not fit is refused here.
 */
function unpackIpfBitmap(data: Buffer, layout: IpfLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	let source = layout.bitmapOffset;
	let target = 0;
	const readByte = (): number => {
		const value = data[source];
		if (undefined === value) {
			throw invalidImage("The packed pixels of the picture are cut short");
		}
		source += 1;
		return value;
	};
	while (target < output.length) {
		const control = readByte();
		if (CONTROL_END === control) break;
		if (CONTROL_ESCAPE === control) {
			output[target] = control;
			target += 1;
			continue;
		}
		if (control < CONTROL_FILL) {
			const count = (((control << 8) | readByte()) + 1) >>> 0;
			const value = readByte();
			if (target + count > output.length) {
				throw invalidImage("A run of the picture outgrows it");
			}
			output.fill(value, target, target + count);
			target += count;
			continue;
		}
		if (control < CONTROL_COPY) {
			const distance =
				((((control - CONTROL_FILL) << 8) | readByte()) + 1) >>> 0;
			const count = readByte() + 1;
			if (target + count > output.length) {
				throw invalidImage("A run of the picture outgrows it");
			}
			const from = target - distance;
			if (from < 0) {
				throw invalidImage("A run of the picture reaches before its start");
			}
			for (let index = 0; index < count; index += 1) {
				output[target] = output[from + index] ?? 0;
				target += 1;
			}
			continue;
		}
		output[target] = control - CONTROL_FILL;
		target += 1;
	}
	return output;
}

/** The colours a picture with no palette is shown in: one byte of grey to each of the two hundred and fifty six. */
function greyPalette(): Buffer {
	const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
	for (let index = 0; index < 0x100; index += 1) {
		palette[index * 4] = index;
		palette[index * 4 + 1] = index;
		palette[index * 4 + 2] = index;
	}
	return palette;
}

export function decodeIpf(
	data: Buffer,
	layout: IpfLayout,
): { pixels: Buffer; palette: Buffer } {
	const palette = layout.hasPalette
		? unpackIpfPalette(data, layout)
		: greyPalette();
	if (!layout.compressed) {
		const needed = layout.width * layout.height;
		const end = layout.bitmapOffset + needed;
		if (end > data.length) {
			throw invalidImage("The pixels of the picture are cut short");
		}
		return {
			pixels: Buffer.from(data.subarray(layout.bitmapOffset, end)),
			palette,
		};
	}
	return { pixels: unpackIpfBitmap(data, layout), palette };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const technoBrainIpfImageDescriptor: FormatDescriptor = {
	id: "techno-brain-ipf-image",
	name: "TechnoBrain Inteligent Picture Format",
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
			source: "ArcFormats/TechnoBrain/ImageIPF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const technoBrainIpfImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: technoBrainIpfImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(FORMAT_TAG_FIELD + 8)) return false;
		return readIpfLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readIpfLayout(stored);
		if (!layout) {
			throw invalidImage("Not a TechnoBrain picture");
		}
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
					bitsPerPixel: layout.bitsPerPixel,
				},
			}),
			// The picture is reserialised as a bitmap, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
				palette: layout.hasPalette,
				compressed: layout.compressed,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readIpfLayout(stored);
		if (!layout) {
			throw invalidImage("Not a TechnoBrain picture");
		}
		const { pixels, palette } = decodeIpf(stored, layout);
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette, false),
		]);
	},
});
