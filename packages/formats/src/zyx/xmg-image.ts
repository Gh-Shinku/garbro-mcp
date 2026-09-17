// Format reference: GARbro "ArcFormats/Zyx/ImageXMG.cs", class `XmgFormat` (an eight bit indexed picture
// whose twelve byte header and colour map are obfuscated and whose pixels are a six bit run walk). GARbro
// commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference gates on this extension before it looks inside the file. */
const EXTENSION = "xmg";
/** The obfuscated header, whose two last measurement bytes are the ones the tag check reads. */
const HEADER_SIZE = 12;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 6;
/** The obfuscated colour map of two hundred and fifty six three byte entries. */
const PALETTE_SIZE = 0x300;
const PALETTE_ENTRIES = 0x100;
const PIXEL_OFFSET = HEADER_SIZE + PALETTE_SIZE;
/** The key the header walk starts at, and the one the colour map continues from. */
const HEADER_KEY = 0;
const PALETTE_KEY = HEADER_SIZE * 7;
const KEY_STEP = 7;
const OBFUSCATION = 0xf3;
/** Above the run counts stands the walk's own state; the six bit height of a colour map index is the width. */
const COLOR_INDEX_MASK = 0x0f;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface XmgLayout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `XmgFormat.Decrypt`: every byte is shifted down by a key that steps by seven and then turned over by
 * `0xf3`, both held to eight bits. The walk is its own inverse when given the same starting key, so the
 * caller either decodes a stored field or encodes a plain one.
 */
export function decryptXmg(data: Buffer, key = 0): Buffer {
	const output: Buffer = Buffer.alloc(data.length);
	let current = key & 0xff;
	for (let i = 0; i < data.length; i += 1) {
		output[i] = (((data[i] ?? 0) - current) & 0xff) ^ OBFUSCATION;
		current = (current + KEY_STEP) & 0xff;
	}
	return output;
}

/**
 * `XmgFormat.ConvertPalette`: the entries of the colour map stand blue, red, green, so the second, third
 * and first byte of each become red, green and blue. A bitmap wants blue, green, red and nothing, which is
 * what the entries are turned into here.
 */
export function convertXmgPalette(plain: Buffer): Buffer {
	const entries: Buffer = Buffer.alloc(PALETTE_ENTRIES * 4, 0x00);
	for (let index = 0; index < PALETTE_ENTRIES; index += 1) {
		const source = index * 3;
		entries[index * 4] = plain[source] ?? 0;
		entries[index * 4 + 1] = plain[source + 2] ?? 0;
		entries[index * 4 + 2] = plain[source + 1] ?? 0;
	}
	return entries;
}

/**
 * `XmgFormat.ReadMetaData`: the reference only looks at a file with the `.xmg` extension. It decodes the
 * twelve byte header and requires the two bytes behind the tag word to be clear, then reads the width and
 * the height as signed words and refuses either of them being zero or less. The depth is always reported
 * as eight bits.
 */
export function readXmgHeader(plain: Buffer): XmgLayout | undefined {
	if (plain.length < HEADER_SIZE) return undefined;
	if (plain[2] !== 0 || plain[3] !== 0) return undefined;
	const width = plain.readInt16LE(WIDTH_FIELD);
	const height = plain.readInt16LE(HEIGHT_FIELD);
	if (width <= 0 || height <= 0) return undefined;
	return { width, height };
}

async function readLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<XmgLayout | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(PIXEL_OFFSET)) return undefined;
	try {
		const stored = Buffer.from(
			await source.readAt(0n, HEADER_SIZE + PALETTE_SIZE),
		);
		if (stored.length < HEADER_SIZE) return undefined;
		return readXmgHeader(
			decryptXmg(stored.subarray(0, HEADER_SIZE), HEADER_KEY),
		);
	} catch {
		return undefined;
	}
}

/**
 * `XmgFormat.Read`: the pixel stream is a walk of three kinds of command, taken a row at a time — every row
 * reads commands until its own width is filled, and the walk carries on with the next row at the next
 * command, so a command may cross a row's edge. A control byte with its two highest bits clear holds that
 * many literal pixels itself, of which a count of nothing means the byte behind it plus sixty four. A
 * control byte with only its highest bit clear repeats the pixel before it, one more than the same count.
 * A control byte with its highest bit standing copies a run from behind the place it stands at, of which
 * the low twelve bits of the control byte and the byte behind it are the distance, and the three bits in
 * the middle of the control byte are the count — of nothing that means the byte behind it plus ten, and two
 * more than either says. The run is copied forwards, so it may read what it has just written. A stream that
 * stops where a command or a literal is wanted is refused, as is a command that writes past the picture.
 */
export function unpackXmg(input: Buffer, layout: XmgLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height, 0x00);
	let position = PIXEL_OFFSET;
	const readByte = (): number => {
		if (position >= input.length) {
			throw invalidPicture("Zyx XMG picture is cut short of its stream");
		}
		const value = input[position] ?? 0;
		position += 1;
		return value;
	};
	let dst = 0;
	for (let y = 0; y < layout.height; y += 1) {
		let x = 0;
		while (x < layout.width) {
			const control = readByte();
			let count: number;
			if (0 === (control & 0xc0)) {
				count = control & 0x3f;
				if (0 === count) count = readByte() + 0x40;
				if (dst + count > output.length) {
					throw invalidPicture("Zyx XMG picture writes past its own end");
				}
				for (let index = 0; index < count; index += 1) {
					output[dst + index] = readByte();
				}
			} else if (0 === (control & 0x80)) {
				count = control & 0x3f;
				if (0 === count) count = readByte() + 0x40;
				count += 1;
				if (dst < 1 || dst + count > output.length) {
					throw invalidPicture("Zyx XMG picture writes past its own end");
				}
				const pixel = output[dst - 1] ?? 0;
				for (let index = 0; index < count; index += 1) {
					output[dst + index] = pixel;
				}
			} else {
				const distance = (((control << 8) | readByte()) & 0xfff) + 1;
				count = (control & 0x70) >> 4;
				if (0 === count) count = readByte() + 10;
				else count += 2;
				if (dst - distance < 0 || dst + count > output.length) {
					throw invalidPicture("Zyx XMG picture writes past its own end");
				}
				for (let index = 0; index < count; index += 1) {
					output[dst + index] = output[dst + index - distance] ?? 0;
				}
			}
			x += count;
			dst += count;
		}
	}
	return output;
}

export const zyxXmgImageDescriptor: FormatDescriptor = {
	id: "zyx-xmg-image",
	name: "ZyX image format",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Zyx/ImageXMG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const zyxXmgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: zyxXmgImageDescriptor,
	// The reference declares no signature; the extension gate is the only way in.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a Zyx XMG picture");
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
					bitsPerPixel: 8,
				},
			}),
			// The pixels are unfolded from a walk and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "rle",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 8,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const layout = await readLayout(source, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a Zyx XMG picture");
		}
		const size = layout.width * layout.height;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Zyx XMG picture of ${size} bytes is too large`,
			);
		}
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored.length < PIXEL_OFFSET) {
			throw invalidPicture("Zyx XMG picture is cut short of its colour map");
		}
		const palette = convertXmgPalette(
			decryptXmg(stored.subarray(HEADER_SIZE, PIXEL_OFFSET), PALETTE_KEY),
		);
		const pixels = unpackXmg(stored, layout);
		// `ImageData.Create` keeps the stored order top down, which a bitmap records with a negative height.
		return Readable.from([
			writeBmp8Palette(layout.width, layout.height, pixels, palette),
		]);
	},
});
