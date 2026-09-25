// Format reference: GARbro "ArcFormats/Ikura/ImageDRG.cs", classes `DrgFormat`, `DrgIndexedFormat` and
// `Gga0Format` with the metadata classes beside them.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	writeBmp8Palette,
	writeBmp16,
	writeBmp24,
	writeBmp32,
	RGB565_MASKS,
} from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import { copyOverlapped } from "../shared/copy.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The place of the file the walk of a picture of the engine stands at, of the places of a pixel. */
const PLACES = 3;
/** The words of the file of the engine stand of the places of the file the other way around. */
const FULL = 0x4c4c5546; // 'FULL'
const TRUE = 0x45555254; // 'TRUE'
const HIGH = 0x48474948; // 'HIGH'
const BITS_16 = 16;
const BITS_24 = 24;
const BITS_32 = 32;
const DRG_HEAD_SIZE = 8;
const MAX_SIDE = 0x8000;

/** The marks of the indexed picture of the engine and of the picture of the fourth kind. */
const INDEXED_MARK = 0x47363532; // '256G'
const INDEXED_HEAD = 0x1c;
const PALETTE_SIZE = 0x400;
const PALETTE_ENTRY = 4;
const FLIPPED_FIELD = 12;
const BITMAP_SIZE_FIELD = 24;

const GGA_MARK = "GGA00000";
const GGA_HEAD_SIZE = 24;
const GGA_WIDTH_FIELD = 8;
const GGA_HEIGHT_FIELD = 10;
const GGA_BITS_FIELD = 14;
const GGA_FLAGS_FIELD = 15;
const GGA_HEADER_FIELD = 16;
const GGA_SIZE_FIELD = 20;

export interface DrgLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** `DrgFormat.ReadMetaData`: the head of the picture, whose mark stands of the places of the file. */
export function readDrgLayout(data: Buffer): DrgLayout | undefined {
	if (data.length < DRG_HEAD_SIZE) return undefined;
	const mark = data.readUInt32LE(0);
	// The marks of the file of the engine stand of the places of the file the other way around from the
	// words the engine holds them as: `FULL`, `TRUE` and `HIGH`.
	let bitsPerPixel: number;
	if (~FULL >>> 0 === mark || ~TRUE >>> 0 === mark) {
		bitsPerPixel = BITS_24;
	} else if (~HIGH >>> 0 === mark) {
		bitsPerPixel = BITS_16;
	} else {
		return undefined;
	}
	const width = data.readUInt16LE(4);
	const height = data.readUInt16LE(6);
	if (0 === width || 0 === height) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	return { width, height, bitsPerPixel };
}

/** The marks `FULL`, `TRUE` and `HIGH`, of the places of the file of the engine the other way around. */
export function drgSignatures(): readonly { bytes: Uint8Array }[] {
	return [FULL, TRUE, HIGH].map((word) => {
		const bytes: Buffer = Buffer.alloc(4, 0x00);
		bytes.writeUInt32LE(~word >>> 0, 0);
		return { bytes };
	});
}

/** `DrgFormat.DecodeStream`: the places of the file of a picture, of the places of a pixel of it. */
function decodeDrgPlaces(data: Buffer, layout: DrgLayout): Buffer {
	const stride = ((layout.width * layout.bitsPerPixel) / 8 + 3) & ~3;
	const output: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let at = DRG_HEAD_SIZE;
	let out = 0;
	const byte = (): number => {
		if (at >= data.length) {
			throw invalidPicture("The walk of the picture stands short of the file");
		}
		const value = data[at] ?? 0;
		at += 1;
		return value;
	};
	while (out < output.length) {
		if (at >= data.length) break;
		const opcode = byte();
		const remaining = output.length - out;
		let count: number;
		let src: number;
		switch (opcode) {
			case 0:
				count = Math.min(PLACES * byte(), remaining);
				src = out - PLACES;
				if (count < 0 || src < 0) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				copyOverlapped(output, src, out, count);
				break;
			case 1:
				count = Math.min(PLACES * byte(), remaining);
				src = out - PLACES * byte();
				if (count < 0 || src < 0 || src === out) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				copyOverlapped(output, src, out, count);
				break;
			case 2: {
				count = Math.min(PLACES * byte(), remaining);
				const low = byte();
				const high = byte();
				src = out - PLACES * ((high << 8) | low);
				if (count < 0 || src < 0 || src === out) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				copyOverlapped(output, src, out, count);
				break;
			}
			case 3:
				count = Math.min(PLACES, remaining);
				src = out - PLACES * byte();
				if (src < 0 || src === out) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				output.copy(output, out, src, src + count);
				break;
			case 4: {
				count = Math.min(PLACES, remaining);
				const low = byte();
				const high = byte();
				src = out - PLACES * ((high << 8) | low);
				if (src < 0 || src === out) {
					throw invalidPicture(
						"The run of the walk stands of no places of the picture",
					);
				}
				output.copy(output, out, src, src + count);
				break;
			}
			default:
				count = Math.min(PLACES * (opcode - 4), remaining);
				for (let place = 0; place < count; place += 1) {
					output[out + place] = byte();
				}
				break;
		}
		out += count;
	}
	return output;
}

/** The places of the file of a picture, of the places of the rows of it of their own. */
function packDrgPlaces(
	places: Buffer,
	width: number,
	height: number,
	bpp: number,
): Buffer {
	const stride = ((width * bpp) / 8 + 3) & ~3;
	const rowSize = (width * bpp) / 8;
	const packed: Buffer = Buffer.alloc(rowSize * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		places.copy(packed, row * rowSize, row * stride, row * stride + rowSize);
	}
	return packed;
}

/** `DrgFormat.Read`: the picture of the walk of the engine, handed over as a bitmap. */
export function unpackDrgPicture(data: Buffer, layout: DrgLayout): Buffer {
	const places = decodeDrgPlaces(data, layout);
	const packed = packDrgPlaces(
		places,
		layout.width,
		layout.height,
		layout.bitsPerPixel,
	);
	if (BITS_16 === layout.bitsPerPixel) {
		return writeBmp16(layout.width, layout.height, packed, false, RGB565_MASKS);
	}
	return writeBmp24(layout.width, layout.height, packed);
}

export interface GgdLayout {
	width: number;
	height: number;
	headerSize: number;
	bitmapSize: number;
	flipped: boolean;
}

/** `DrgIndexedFormat.ReadMetaData`: the head of the indexed picture of the engine. */
export function readGgdLayout(data: Buffer): GgdLayout | undefined {
	if (data.length < INDEXED_HEAD) return undefined;
	if (~INDEXED_MARK >>> 0 !== data.readUInt32LE(0)) return undefined;
	const headerSize = data.readUInt32LE(4);
	const width = data.readUInt32LE(8);
	let height = data.readInt32LE(FLIPPED_FIELD);
	let flipped = false;
	if (height < 0) {
		height = -height;
		flipped = true;
	}
	const bitmapSize = data.readUInt32LE(BITMAP_SIZE_FIELD);
	if (0 === width || 0 === height) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	if (headerSize + PALETTE_ENTRY + PALETTE_SIZE > data.length) return undefined;
	return { width, height, headerSize, bitmapSize, flipped };
}

/** The mark `256G` of the places of the file of the engine, of the places of them the other way around. */
export function ggdSignatures(): readonly { bytes: Uint8Array }[] {
	const bytes: Buffer = Buffer.alloc(4, 0x00);
	bytes.writeUInt32LE(~INDEXED_MARK >>> 0, 0);
	return [{ bytes }];
}

/** `DrgIndexedFormat.Read`: the table of the colours of the picture and the walk of the places of it. */
export function unpackGgdPicture(data: Buffer, layout: GgdLayout): Buffer {
	const paletteAt = layout.headerSize + PALETTE_ENTRY;
	const palette = data.subarray(paletteAt, paletteAt + PALETTE_SIZE);
	const walkAt = paletteAt + PALETTE_SIZE + PALETTE_ENTRY;
	if (walkAt > data.length) {
		throw invalidPicture("The walk of the picture stands short of the file");
	}
	const places = inflateLzss(data.subarray(walkAt), {
		outputLength: layout.bitmapSize,
	});
	// The places of a row of the picture stand of the places of the width of it, of the places of the file
	// of the row behind them: the walk of the reference stands of the places of a row of the picture of the
	// places of the file of it, of the places of the BMP of the engine.
	const rowSize = layout.width;
	const packed: Buffer = Buffer.alloc(rowSize * layout.height, 0x00);
	const stride = (rowSize + 3) & ~3;
	for (let row = 0; row < layout.height; row += 1) {
		places.copy(packed, row * rowSize, row * stride, row * stride + rowSize);
	}
	return writeBmp8Palette(layout.width, layout.height, packed, palette);
}

export interface Gga0Layout {
	width: number;
	height: number;
	bitsPerPixel: number;
	flags: number;
	headerSize: number;
	compSize: number;
}

/** `Gga0Format.ReadMetaData`: the head of the picture of the fourth kind of the engine. */
export function readGga0Layout(data: Buffer): Gga0Layout | undefined {
	if (data.length < GGA_HEAD_SIZE) return undefined;
	if (GGA_MARK !== data.subarray(0, 8).toString("latin1")) return undefined;
	const width = data.readUInt16LE(GGA_WIDTH_FIELD);
	const height = data.readUInt16LE(GGA_HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	if (width > MAX_SIDE || height > MAX_SIDE) return undefined;
	return {
		width,
		height,
		bitsPerPixel: data[GGA_BITS_FIELD] ?? 0,
		flags: data[GGA_FLAGS_FIELD] ?? 0,
		headerSize: data.readUInt32LE(GGA_HEADER_FIELD),
		compSize: data.readUInt32LE(GGA_SIZE_FIELD),
	};
}

export function gga0Signatures(): readonly { bytes: Uint8Array }[] {
	return [{ bytes: Buffer.from("GGA0", "latin1") }];
}

/** `Gga0Format.DecodeStream`: the places of the picture, of the walks of the places of the file of it. */
function decodeGga0Places(data: Buffer, layout: Gga0Layout): Buffer {
	const output: Buffer = Buffer.alloc(layout.width * layout.height * 4, 0x00);
	let at = layout.headerSize;
	const end = at + layout.compSize;
	let out = 0;
	const byte = (): number => {
		if (at >= data.length) {
			throw invalidPicture("The walk of the picture stands short of the file");
		}
		const value = data[at] ?? 0;
		at += 1;
		return value;
	};
	const word = (): number => {
		if (at + 2 > data.length) {
			throw invalidPicture("The walk of the picture stands short of the file");
		}
		const value = data.readUInt16LE(at);
		at += 2;
		return value;
	};
	const put = (srcOffset: number, count: number): void => {
		const src = out + srcOffset;
		if (src < 0 || count < 0 || out + count > output.length) {
			throw invalidPicture(
				"The run of the walk stands of no places of the picture",
			);
		}
		copyOverlapped(output, src, out, count);
		out += count;
	};
	const copy = (srcOffset: number): void => {
		const src = out + srcOffset;
		if (src < 0 || out + 4 > output.length) {
			throw invalidPicture(
				"The run of the walk stands of no places of the picture",
			);
		}
		output.copy(output, out, src, src + 4);
		out += 4;
	};
	const widthPlaces = layout.width * 4;
	while (at < end) {
		const code = byte();
		switch (code) {
			case 0:
				put(-4, byte() * 4);
				break;
			case 1:
				put(-4, word() * 4);
				break;
			case 2:
				copy(-(byte() << 2));
				break;
			case 3:
				copy(-(word() << 2));
				break;
			case 4:
				put(-(byte() << 2), byte() * 4);
				break;
			case 5:
				put(-(byte() << 2), word() * 4);
				break;
			case 6:
				put(-(word() << 2), byte() * 4);
				break;
			case 7:
				put(-(word() << 2), word() * 4);
				break;
			case 8:
				copy(-4);
				break;
			case 9:
				copy(-widthPlaces);
				break;
			case 0x0a:
				copy(-(widthPlaces + 4));
				break;
			case 0x0b:
				copy(-(widthPlaces - 4));
				break;
			default: {
				const count = (code - 11) * 4;
				if (out + count > output.length) {
					throw invalidPicture(
						"The run of the walk stands past the places of the picture",
					);
				}
				for (let place = 0; place < count; place += 1) {
					output[out + place] = byte();
				}
				out += count;
				break;
			}
		}
	}
	return output;
}

/** `Gga0Format.Read`: the picture of the walk of the engine, handed over as a bitmap. */
export function unpackGga0Picture(data: Buffer, layout: Gga0Layout): Buffer {
	const places = decodeGga0Places(data, layout);
	return writeBmp32(layout.width, layout.height, places);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function imageEntry(
	source: ByteSource,
	sourcePath: string,
	width: number,
	height: number,
	bitsPerPixel: number,
	extra: Record<string, unknown> = {},
): FixedEntry {
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
			offset: 0n,
			size: source.size,
			compressed: true,
			metadata: { type: "image", width, height, bitsPerPixel, ...extra },
		}),
		sizeKnown: false,
	};
}

export const drgImageDescriptor: FormatDescriptor = {
	id: "ikura-drg-image",
	name: "Digital Romance System image",
	extensions: ["drg", "ggd", "dgd"],
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
			source: "ArcFormats/Ikura/ImageDRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const drgImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: drgImageDescriptor,
	detection: { signatures: drgSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(DRG_HEAD_SIZE)) return false;
		try {
			return readDrgLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readDrgLayout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Ikura engine");
		return {
			entries: [
				imageEntry(
					source,
					sourcePath,
					layout.width,
					layout.height,
					layout.bitsPerPixel,
				),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: layout.bitsPerPixel,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readDrgLayout(data);
		if (!layout) throw invalidPicture("Not a picture of the Ikura engine");
		return Readable.from([unpackDrgPicture(data, layout)]);
	},
});

export const ggdIndexedImageDescriptor: FormatDescriptor = {
	id: "ikura-ggd-image",
	name: "Digital Romance System indexed image",
	extensions: ["ggd"],
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
			source: "ArcFormats/Ikura/ImageDRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ggdIndexedImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ggdIndexedImageDescriptor,
	detection: { signatures: ggdSignatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(INDEXED_HEAD)) return false;
		try {
			return readGgdLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGgdLayout(await readStored(source));
		if (!layout)
			throw invalidPicture("Not an indexed picture of the Ikura engine");
		return {
			entries: [
				imageEntry(source, sourcePath, layout.width, layout.height, 8, {
					flipped: layout.flipped,
				}),
			],
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
		const layout = readGgdLayout(data);
		if (!layout)
			throw invalidPicture("Not an indexed picture of the Ikura engine");
		return Readable.from([unpackGgdPicture(data, layout)]);
	},
});

export const gga0ImageDescriptor: FormatDescriptor = {
	id: "ikura-gga0-image",
	name: "IKURA GDL image",
	extensions: ["gg1", "gg2", "gg3", "gg0"],
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
			source: "ArcFormats/Ikura/ImageDRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gga0ImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gga0ImageDescriptor,
	detection: { signatures: gga0Signatures(), extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(GGA_HEAD_SIZE)) return false;
		try {
			return readGga0Layout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readGga0Layout(await readStored(source));
		if (!layout) throw invalidPicture("Not a picture of the Ikura engine");
		return {
			entries: [
				imageEntry(source, sourcePath, layout.width, layout.height, BITS_32, {
					flags: layout.flags,
				}),
			],
			metadata: {
				image: "bmp",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_32,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readGga0Layout(data);
		if (!layout) throw invalidPicture("Not a picture of the Ikura engine");
		return Readable.from([unpackGga0Picture(data, layout)]);
	},
});
