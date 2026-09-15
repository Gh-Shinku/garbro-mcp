// Format reference: GARbro "Legacy/System21/ImageBET.cs", classes `BetFormat` and `LzBetFormat` (System21
// image format, and the same picture behind a stream of Microsoft LZSS). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss, type LzssStreamSettings } from "@garbro-mcp/codecs";
import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp24, writeBmp8Palette } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";

/** Both formats are told apart by the name of their file, which the reference asks for first of all. */
const EXTENSION = ".bet";
const SZDD_SIGNATURE = Buffer.from("SZDD", "latin1");
/** The measurements and the depth of the picture, which both formats keep at the start of theirs. */
const HEADER_SIZE = 10;
/** The header of a compressed picture: the word above, the way it was packed, and the length it unfolds to. */
const SZDD_HEADER_SIZE = 0x0e;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 4;
const BPP_FIELD = 8;
const PALETTE_SIZE = 0x100 * 4;
const DEPTH_8 = 8;
const DEPTH_24 = 24;
const MAXIMUM_SIDE = 0x8000;
const MAXIMUM_PICTURE_BYTES = 256 * 1024 * 1024;
/** `LzBetFormat.OpenLzStream`: the ring of the Microsoft variant, filled with spaces and started one short. */
const LZSS_SETTINGS: LzssStreamSettings = {
	frameSize: 0x1000,
	frameFill: 0x20,
	frameInitPosition: 0x1000 - 0x10,
};

export interface BetLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function hasExtension(sourcePath: string): boolean {
	const fileName = sourcePath.replace(/^.*[/\\]/, "").toLowerCase();
	return fileName.endsWith(EXTENSION);
}

/**
 * `BetFormat.ReadMetaData`: the measurements of the picture as two long words and its depth as a word behind
 * them, which must be **eight or twenty four bits** and must measure between one and `0x8000` either way.
 * Both formats keep this at the start of the picture, whether it stands in the file or unfolds into it, and
 * both are told apart by the name of the file, which must end with `.bet`.
 */
export function readBetLayout(
	data: Buffer,
	sourcePath?: string,
): BetLayout | undefined {
	if (sourcePath !== undefined && !hasExtension(sourcePath)) return undefined;
	if (data.length < HEADER_SIZE) return undefined;
	const bitsPerPixel = data.readUInt16LE(BPP_FIELD);
	if (bitsPerPixel !== DEPTH_8 && bitsPerPixel !== DEPTH_24) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	if (
		width === 0 ||
		width > MAXIMUM_SIDE ||
		height === 0 ||
		height > MAXIMUM_SIDE
	) {
		return undefined;
	}
	return { width, height, bitsPerPixel };
}

/** How many bytes of a picture the reference reads behind its header, palette and all. */
export function betBodyLength(layout: BetLayout): number {
	const rowBytes = (layout.width * layout.bitsPerPixel) / 8;
	const palette = DEPTH_8 === layout.bitsPerPixel ? PALETTE_SIZE : 0;
	return HEADER_SIZE + palette + rowBytes * layout.height;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `BetFormat.Read`: a colour map of two hundred and fifty six four byte entries first — only for an eight bit
 * picture, and read the way the reference reads it — and then the pixels, with no padding between the rows,
 * **turned over**: every byte of theirs is taken with `0xFF`. The colour map is left as it stands. A picture
 * the file is cut short of is refused where the reference's own reading would throw.
 */
export function unpackBet(
	data: Buffer,
	layout: BetLayout,
): { pixels: Buffer; palette: Buffer | undefined } {
	const rowBytes = (layout.width * layout.bitsPerPixel) / 8;
	const length = rowBytes * layout.height;
	if (!Number.isSafeInteger(length) || length > MAXIMUM_PICTURE_BYTES) {
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`System21 picture of ${length} bytes is too large`,
		);
	}
	let offset = HEADER_SIZE;
	let palette: Buffer | undefined;
	if (DEPTH_8 === layout.bitsPerPixel) {
		if (offset + PALETTE_SIZE > data.length) {
			throw invalidPicture("System21 picture carries no whole colour map");
		}
		palette = Buffer.from(data.subarray(offset, offset + PALETTE_SIZE));
		offset += PALETTE_SIZE;
	}
	if (offset + length > data.length) {
		throw invalidPicture("System21 picture is cut short of its pixels");
	}
	const pixels = Buffer.from(data.subarray(offset, offset + length));
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (pixels[index] ?? 0) ^ 0xff;
	}
	return { pixels, palette };
}

/** `LzBetFormat.OpenLzStream`: the stream behind the fourteen byte header of the packed picture. */
function unfoldLzBet(stored: Buffer, length: number): Buffer {
	if (stored.length <= SZDD_HEADER_SIZE) return Buffer.alloc(0);
	return inflateLzss(stored.subarray(SZDD_HEADER_SIZE), {
		...LZSS_SETTINGS,
		outputLength: length,
	});
}

/** The picture is written the way the reference hands it out: its rows bottom up, as `CreateFlipped` says. */
function writeBet(
	layout: BetLayout,
	picture: {
		pixels: Buffer;
		palette: Buffer | undefined;
	},
): Buffer {
	if (DEPTH_24 === layout.bitsPerPixel) {
		return writeBmp24(layout.width, layout.height, picture.pixels, true);
	}
	if (!picture.palette) {
		throw invalidPicture("System21 picture carries no whole colour map");
	}
	return writeBmp8Palette(
		layout.width,
		layout.height,
		picture.pixels,
		picture.palette,
		true,
	);
}

function betEntry(
	source: ByteSource,
	sourcePath: string,
	layout: BetLayout,
	compressed: boolean,
) {
	const fileName = sourcePath.replace(/^.*[/\\]/, "");
	return {
		entries: [
			{
				...createFixedEntry({
					id: 0,
					path: changeExtension(fileName, "bmp"),
					offset: 0n,
					size: source.size,
					compressed,
					metadata: {
						type: "image",
						width: layout.width,
						height: layout.height,
						bitsPerPixel: layout.bitsPerPixel,
					},
				}),
				sizeKnown: false,
			},
		],
		metadata: {
			image: "bmp",
			width: layout.width,
			height: layout.height,
			bitsPerPixel: layout.bitsPerPixel,
		},
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const betImageDescriptor: FormatDescriptor = {
	id: "system21-bet-image",
	name: "System21 image format",
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
			source: "Legacy/System21/ImageBET.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const betImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: betImageDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return readBetLayout(await readStored(source), sourcePath) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readBetLayout(stored, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a System21 picture");
		}
		return betEntry(source, sourcePath, layout, false);
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readBetLayout(stored, sourcePath);
		if (!layout) {
			throw invalidPicture("Not a System21 picture");
		}
		return Readable.from([writeBet(layout, unpackBet(stored, layout))]);
	},
});

export const lzBetImageDescriptor: FormatDescriptor = {
	id: "system21-bet-szdd-image",
	name: "System21 compressed image format",
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
			source: "Legacy/System21/ImageBET.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lzBetImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lzBetImageDescriptor,
	detection: { signatures: [{ bytes: SZDD_SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath)) return false;
		const stored = await readStored(source);
		if (!stored.subarray(0, 4).equals(SZDD_SIGNATURE)) return false;
		return (
			readBetLayout(unfoldLzBet(stored, HEADER_SIZE), sourcePath) !== undefined
		);
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		if (!hasExtension(sourcePath)) {
			throw invalidPicture("Not a System21 picture");
		}
		const layout = readBetLayout(unfoldLzBet(stored, HEADER_SIZE), sourcePath);
		if (!layout) {
			throw invalidPicture("Not a System21 picture");
		}
		return betEntry(source, sourcePath, layout, true);
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		if (!hasExtension(sourcePath)) {
			throw invalidPicture("Not a System21 picture");
		}
		const layout = readBetLayout(unfoldLzBet(stored, HEADER_SIZE), sourcePath);
		if (!layout) {
			throw invalidPicture("Not a System21 picture");
		}
		const length = betBodyLength(layout);
		if (length > MAXIMUM_PICTURE_BYTES) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`System21 picture of ${length} bytes is too large`,
			);
		}
		return Readable.from([
			writeBet(layout, unpackBet(unfoldLzBet(stored, length), layout)),
		]);
	},
});
