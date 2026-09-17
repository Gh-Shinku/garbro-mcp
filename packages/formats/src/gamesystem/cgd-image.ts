// Format reference: GARbro "ArcFormats/GameSystem/ImageCGD.cs", classes `CgdFormat` and `CgdReader` (a GameSystem
// picture whose head declares the file's own length and whose pixels are a walk of signed colour steps).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head, whose first word is the file's own length. */
const HEADER_SIZE = 0x10;
const LENGTH_FIELD = 0;
const WIDTH_FIELD = 4;
const HEIGHT_FIELD = 8;
/** The head may be left out of the length the first word declares. */
const LENGTH_WITHOUT_HEAD = 0x10;
const MAX_DIMENSION = 0x8000;
/** The steps of the walk. */
const STEP_LIMIT = 0x80;
const REPEAT_LIMIT = 0xc0;
const LITERAL = 0xff;
/** A picture this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/**
 * `CgdReader.InitColorTable`: every word is three five bit channels, of which the highest bit is the sign, so
 * a channel above fifteen is its own value less thirty two. The three bytes of an entry stand blue, green and
 * red.
 */
const COLOR_TABLE: Buffer = (() => {
	const table: Buffer = Buffer.alloc(0x8000 * 3, 0x00);
	const signed = (value: number): number =>
		(value > 15 ? value - 32 : value) & 0xff;
	for (let index = 0; index < 0x8000; index += 1) {
		table[index * 3] = signed(index & 0x1f);
		table[index * 3 + 1] = signed((index >> 5) & 0x1f);
		table[index * 3 + 2] = signed((index >> 10) & 0x1f);
	}
	return table;
})();

export interface CgdLayout {
	width: number;
	height: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `CgdFormat.ReadMetaData`: the first word of the file is the file's own length, or that length less the
 * sixteen bytes of the head, and the width and the height behind it are both between one and `0x8000`. The
 * depth is always reported as twenty four bits.
 */
export function readCgdLayout(
	data: Buffer,
	fileLength = data.length,
): CgdLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const declared = data.readUInt32LE(LENGTH_FIELD);
	if (
		declared !== fileLength &&
		declared !== fileLength - LENGTH_WITHOUT_HEAD
	) {
		return undefined;
	}
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (
		width === 0 ||
		width > MAX_DIMENSION ||
		height === 0 ||
		height > MAX_DIMENSION
	) {
		return undefined;
	}
	const size = width * height * 3;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	return { width, height };
}

/**
 * `CgdReader.Unpack`: the colour stands as three bytes from the first pixel on, and every command steps it.
 * A control byte below `0x80` is a step whose own word — the control's low seven bits above the byte behind
 * it — names an entry of the colour table; the three signed channels of that entry are added to the colour
 * as it stands and the sum is the next pixel. A control from `0x80` to `0xBF` repeats the colour as it stands
 * that many pixels, one more than the control says less `0x80`. A control of `0xFF` ends the walk where the
 * picture still stands, and every other control reads three times the control less `0xBF` bytes that stand in
 * the stream themselves, which become the last pixels and the colour the walk goes on from.
 */
export function unpackCgd(input: Buffer, layout: CgdLayout): Buffer {
	const stride = layout.width * 3;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let position = HEADER_SIZE;
	let dst = 0;
	let red = 0;
	let green = 0;
	let blue = 0;
	const readByte = (): number => {
		if (position >= input.length) {
			throw invalidPicture("GameSystem picture is cut short of its stream");
		}
		const value = input[position] ?? 0;
		position += 1;
		return value;
	};
	while (dst < output.length) {
		const control = readByte();
		if (control < STEP_LIMIT) {
			const entry = (readByte() | (control << 8)) * 3;
			blue = (blue + (COLOR_TABLE[entry] ?? 0)) & 0xff;
			green = (green + (COLOR_TABLE[entry + 1] ?? 0)) & 0xff;
			red = (red + (COLOR_TABLE[entry + 2] ?? 0)) & 0xff;
			output[dst] = blue;
			output[dst + 1] = green;
			output[dst + 2] = red;
			dst += 3;
		} else if (control < REPEAT_LIMIT) {
			const count = control - 0x7f;
			if (dst + count * 3 > output.length) {
				throw invalidPicture("GameSystem picture writes past its own end");
			}
			for (let index = 0; index < count; index += 1) {
				output[dst] = blue;
				output[dst + 1] = green;
				output[dst + 2] = red;
				dst += 3;
			}
		} else if (LITERAL === control) {
			break;
		} else {
			const count = (control - 0xbf) * 3;
			if (dst + count > output.length) {
				throw invalidPicture("GameSystem picture writes past its own end");
			}
			const available = Math.min(count, input.length - position);
			for (let index = 0; index < available; index += 1) {
				output[dst + index] = input[position + index] ?? 0;
			}
			position += available;
			if (available < count) break;
			dst += count;
			blue = output[dst - 3] ?? 0;
			green = output[dst - 2] ?? 0;
			red = output[dst - 1] ?? 0;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readLayout(source: ByteSource): Promise<CgdLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		return readCgdLayout(header, Number(source.size));
	} catch {
		return undefined;
	}
}

export const gameSystemCgdImageDescriptor: FormatDescriptor = {
	id: "game-system-cgd-image",
	name: "'GameSystem' CG image format",
	extensions: ["cgd", "crgb"],
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
			source: "ArcFormats/GameSystem/ImageCGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameSystemCgdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameSystemCgdImageDescriptor,
	// The reference declares no signature word; the length in the head is what tells the format apart.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readCgdLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a GameSystem CG picture");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 24,
				},
			}),
			// The pixels are unfolded from a walk and a bitmap header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				image: "bmp",
				compression: "custom",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: 24,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) {
			throw invalidPicture("Not a GameSystem CG picture");
		}
		const stored = await readStored(source);
		const pixels = unpackCgd(stored, layout);
		// `ImageData.CreateFlipped` stores rows bottom up, which a bitmap records with a positive height.
		return Readable.from([
			writeBmp24(layout.width, layout.height, pixels, true),
		]);
	},
});
