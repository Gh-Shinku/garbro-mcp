// Format reference: GARBro "ArcFormats/Cherry/ImageGRP.cs", classes `GrpFormat`, `Grp3Format` and
// `GrpEncFormat` with the `GrpReader` they share, and the `Pak2Opener.Decrypt` of
// "ArcFormats/Cherry/ArcCherry.cs" that the encrypted one is keyed with. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp8Palette, writeBmp24, writeBmp32 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { decryptCherryPairs } from "./pak.js";

/** The head of the first kind of picture, and of the encrypted one. */
const HEADER_SIZE = 0x18;
const WIDTH_FIELD = 0;
const HEIGHT_FIELD = 4;
const DEPTH_FIELD = 8;
const PACKED_SIZE_FIELD = 0x0c;
const UNPACKED_SIZE_FIELD = 0x10;
const OFFSET_FIELD = 0x14;
/** The head of the later kind: two sizes in front of it, and the mark that tells it apart. */
const LATER_HEADER_SIZE = 0x28;
const LATER_MARK = 0xffff;
const LATER_MARK_FIELD = 8;
const LATER_PACKED_SIZE_FIELD = 0;
const LATER_UNPACKED_SIZE_FIELD = 4;
const LATER_WIDTH_FIELD = 0x10;
const LATER_HEIGHT_FIELD = 0x14;
const LATER_DEPTH_FIELD = 0x18;
const LATER_ALPHA_FIELD = 0x24;
/** The offset this kind writes, which is what tells the reader its rows are not turned over. */
const LATER_OFFSET = 0xffff;
/** The offset that says the picture's bytes run all the way to the end of the file. */
const TAIL_OFFSET = 0x0f0f0f0f;
/** The offsets the first kind writes: one for a palette in front of the data, one for none. */
const EIGHT_BIT_OFFSET = 0x418;
const TRUE_COLOUR_OFFSET = 0x018;
/** The bytes the encrypted kind's head carries before it is keyed. */
const ENCRYPTED_MARKS: readonly (readonly [number, number])[] = [
	[3, 0xa5],
	[7, 0x35],
];
/** The words the encrypted kind's head is keyed with, at the places they stand. */
const ENCRYPTION_WORDS: readonly { offset: number; key: number }[] = [
	{ offset: 0, key: 0xa53cc35a },
	{ offset: 4, key: 0x35421005 },
	{ offset: 0x10, key: 0xcf42355d },
];
/** The colours a picture of eight bits carries, four bytes an entry in the order a bitmap takes them. */
const PALETTE_COLORS = 0x100;
const PALETTE_ENTRY = 4;
const PALETTE_SIZE = PALETTE_COLORS * PALETTE_ENTRY;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;
/** The extension every kind of this engine's pictures carries. */
const GRP_EXTENSION = /\.grp$/i;

export interface CherryGrpLayout {
	width: number;
	height: number;
	bitsPerPixel: number;
	packedSize: number;
	unpackedSize: number;
	/** The value the head keeps where the reader looks for a hint about how the rows stand. */
	offset: number;
	headerSize: number;
	alphaChannel: boolean;
	encrypted: boolean;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function isSane(
	width: number,
	height: number,
	bitsPerPixel: number,
	depths: readonly number[],
	packedSize: number,
	unpackedSize: number,
): boolean {
	return (
		0 !== width &&
		0 !== height &&
		width <= 0x7fff &&
		height <= 0x7fff &&
		depths.includes(bitsPerPixel) &&
		unpackedSize > 0 &&
		packedSize >= 0
	);
}

/**
 * `GrpFormat.ReadMetaData`: the head names the size, the depth, the two lengths of the picture and the value
 * the reader looks to for a hint about the rows. Only twenty four bits and eight bits are taken.
 */
export function readCherryGrpLayout(data: Buffer): CherryGrpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const width = data.readUInt32LE(WIDTH_FIELD);
	const height = data.readUInt32LE(HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(DEPTH_FIELD);
	const packedSize = data.readInt32LE(PACKED_SIZE_FIELD);
	const unpackedSize = data.readInt32LE(UNPACKED_SIZE_FIELD);
	if (!isSane(width, height, bitsPerPixel, [24, 8], packedSize, unpackedSize)) {
		return undefined;
	}
	return {
		width,
		height,
		bitsPerPixel,
		packedSize,
		unpackedSize,
		offset: data.readInt32LE(OFFSET_FIELD),
		headerSize: HEADER_SIZE,
		alphaChannel: false,
		encrypted: false,
	};
}

/**
 * `Grp3Format.ReadMetaData`: this kind writes a longer head whose ninth byte is nothing but ones, and it
 * puts the two lengths in front of it. It is the only kind that carries thirty two bits without an alpha
 * channel, and the only one whose rows are not turned over - which the reader learns from the offset being
 * the same mark the head carries.
 */
export function readGrp3Layout(data: Buffer): CherryGrpLayout | undefined {
	if (data.length < LATER_HEADER_SIZE) return undefined;
	if (data.readInt32LE(LATER_MARK_FIELD) !== LATER_MARK) return undefined;
	const packedSize = data.readInt32LE(LATER_PACKED_SIZE_FIELD);
	const unpackedSize = data.readInt32LE(LATER_UNPACKED_SIZE_FIELD);
	const width = data.readUInt32LE(LATER_WIDTH_FIELD);
	const height = data.readUInt32LE(LATER_HEIGHT_FIELD);
	const bitsPerPixel = data.readInt32LE(LATER_DEPTH_FIELD);
	if (
		!isSane(width, height, bitsPerPixel, [32, 24, 8], packedSize, unpackedSize)
	) {
		return undefined;
	}
	return {
		width,
		height,
		bitsPerPixel,
		packedSize,
		unpackedSize,
		offset: LATER_OFFSET,
		headerSize: LATER_HEADER_SIZE,
		alphaChannel: data.readInt32LE(LATER_ALPHA_FIELD) !== 0,
		encrypted: false,
	};
}

/**
 * `GrpEncFormat.ReadMetaData`: the same head as the first kind, keyed word by word, and recognised by two
 * bytes before it is keyed at all. The word that stands where the reader looks for its hint is *not* among
 * the keyed words, so that value is read from the file as it stands.
 */
export function readGrpEncLayout(data: Buffer): CherryGrpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	for (const [at, value] of ENCRYPTED_MARKS) {
		if (data[at] !== value) return undefined;
	}
	const head = Buffer.from(data.subarray(0, HEADER_SIZE));
	for (const word of ENCRYPTION_WORDS) {
		head.writeUInt32LE(
			(head.readUInt32LE(word.offset) ^ word.key) >>> 0,
			word.offset,
		);
	}
	const layout = readCherryGrpLayout(head);
	return layout ? { ...layout, encrypted: true } : undefined;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

/** The palette a picture of eight bits carries: four bytes an entry, blue first. */
function paletteFrom(source: Buffer, offset: number): Buffer {
	if (offset + PALETTE_SIZE > source.length) {
		throw invalidImage("A picture of eight bits is missing its colours");
	}
	return Buffer.from(source.subarray(offset, offset + PALETTE_SIZE));
}

/** `GrpReader.ImageFromStream`: the colours come first for a picture of eight bits, then the pixels. */
function imageFromStream(
	source: Buffer,
	offset: number,
	flipped: boolean,
	layout: CherryGrpLayout,
): { pixels: Buffer; palette: Buffer | undefined; bottomUp: boolean } {
	const stride = layout.width * ((layout.bitsPerPixel + 7) >> 3);
	const length = stride * layout.height;
	if (!Number.isSafeInteger(length) || length > LIMIT) {
		throw invalidImage("The picture is larger than it may be");
	}
	let palette: Buffer | undefined;
	if (8 === layout.bitsPerPixel) {
		palette = paletteFrom(source, offset);
		offset += PALETTE_SIZE;
	}
	if (offset + length > source.length) {
		throw invalidImage("The picture is shorter than its size");
	}
	return {
		pixels: Buffer.from(source.subarray(offset, offset + length)),
		palette,
		// `CreateFlipped` hands the picture over with its rows turned, a plain `Create` does not.
		bottomUp: flipped,
	};
}

/** `GrpReader.ReadV3`: the picture unfolds out of an LZSS stream, which the colours stand at the front of. */
function readLater(
	data: Buffer,
	offset: number,
	flipped: boolean,
	layout: CherryGrpLayout,
): { pixels: Buffer; palette: Buffer | undefined; bottomUp: boolean } {
	const stride = layout.width * ((layout.bitsPerPixel + 7) >> 3);
	const colours = 8 === layout.bitsPerPixel ? PALETTE_SIZE : 0;
	const length = colours + stride * layout.height;
	let unfolded: Buffer;
	try {
		unfolded = inflateLzss(data.subarray(offset), { outputLength: length });
	} catch {
		throw invalidImage("The picture does not unfold");
	}
	if (unfolded.length !== length) {
		throw invalidImage("The picture does not unfold to its size");
	}
	return imageFromStream(unfolded, 0, flipped, layout);
}

/**
 * `GrpReader.ReadV1`: the picture's bytes are keyed with their own place in the stream, then unfolded. The
 * rows of the unfolded picture are read one at a time into the last row first, so the picture comes out the
 * right way up even though the file keeps it turned over.
 */
function readFirst(
	data: Buffer,
	layout: CherryGrpLayout,
): { pixels: Buffer; palette: Buffer | undefined; bottomUp: boolean } {
	const stride = layout.width * ((layout.bitsPerPixel + 7) >> 3);
	let offset = layout.headerSize;
	let palette: Buffer | undefined;
	if (8 === layout.bitsPerPixel) {
		palette = paletteFrom(data, offset);
		offset += PALETTE_SIZE;
	}
	if (offset + layout.packedSize > data.length) {
		throw invalidImage("The picture is shorter than its size");
	}
	const keyed = Buffer.from(data.subarray(offset, offset + layout.packedSize));
	for (let at = 0; at < keyed.length; at += 1) {
		keyed[at] = (keyed[at] ?? 0) ^ (at & 0xff);
	}
	let unfolded: Buffer;
	try {
		unfolded = inflateLzss(keyed, { outputLength: layout.unpackedSize });
	} catch {
		throw invalidImage("The picture does not unfold");
	}
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	let source = 0;
	for (let row = layout.height - 1; row >= 0; row -= 1) {
		const destination = row * stride;
		if (source + stride > unfolded.length) {
			throw invalidImage("The picture does not unfold to its size");
		}
		unfolded.copy(pixels, destination, source, source + stride);
		source += stride;
	}
	return { pixels, palette, bottomUp: false };
}

/**
 * `GrpReader.ReadEncrypted`: everything behind the head is keyed with the engine's pair swap, and the
 * picture behind that unfolds the later way, with its rows turned over.
 */
function readEncrypted(
	data: Buffer,
	layout: CherryGrpLayout,
): { pixels: Buffer; palette: Buffer | undefined; bottomUp: boolean } {
	const body = decryptCherryPairs(
		Buffer.from(data.subarray(layout.headerSize)),
		0,
		data.length - layout.headerSize,
	);
	return readLater(body, 0, true, layout);
}

/**
 * `GrpReader.CreateImage`: which way the picture is read depends on the two lengths and on the value the head
 * kept. The reference tries the first kind's two offset values, then the encrypted path, and takes anything
 * else the later way.
 */
export function decodeGrpImage(
	data: Buffer,
	layout: CherryGrpLayout,
): {
	pixels: Buffer;
	palette: Buffer | undefined;
	bottomUp: boolean;
	bitsPerPixel: number;
} {
	const stride = layout.width * ((layout.bitsPerPixel + 7) >> 3);
	const dataSize =
		0 !== layout.packedSize ? layout.packedSize : layout.unpackedSize;
	let result: {
		pixels: Buffer;
		palette: Buffer | undefined;
		bottomUp: boolean;
	};
	if (
		TAIL_OFFSET === layout.offset &&
		layout.headerSize + dataSize === data.length
	) {
		result =
			0 !== layout.packedSize
				? readLater(data, layout.headerSize, true, layout)
				: imageFromStream(data, layout.headerSize, true, layout);
	} else if (
		(8 === layout.bitsPerPixel && EIGHT_BIT_OFFSET === layout.offset) ||
		(24 === layout.bitsPerPixel && TRUE_COLOUR_OFFSET === layout.offset)
	) {
		result = readFirst(data, layout);
	} else if (layout.encrypted) {
		result = readEncrypted(data, layout);
	} else {
		result = readLater(
			data,
			layout.headerSize,
			LATER_OFFSET !== layout.offset,
			layout,
		);
	}
	if (result.pixels.length !== stride * layout.height) {
		throw invalidImage("The picture is not the size its head names");
	}
	return { ...result, bitsPerPixel: layout.bitsPerPixel };
}

function grpMetadata(layout: CherryGrpLayout) {
	return {
		image: "bmp",
		width: layout.width,
		height: layout.height,
		bitsPerPixel: layout.bitsPerPixel,
		alphaChannel: layout.alphaChannel,
	};
}

function grpEntry(
	layout: CherryGrpLayout,
	sourcePath: string,
	size: bigint,
): FixedEntry {
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
			offset: 0n,
			size,
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
}

function grpBitmap(data: Buffer, layout: CherryGrpLayout): Buffer {
	const { pixels, palette, bottomUp, bitsPerPixel } = decodeGrpImage(
		data,
		layout,
	);
	if (8 === bitsPerPixel) {
		return writeBmp8Palette(
			layout.width,
			layout.height,
			pixels,
			palette ?? Buffer.alloc(PALETTE_SIZE, 0x00),
			bottomUp,
		);
	}
	if (32 === bitsPerPixel) {
		return writeBmp32(layout.width, layout.height, pixels, bottomUp);
	}
	return writeBmp24(layout.width, layout.height, pixels, bottomUp);
}

function makeGrpFormat(options: {
	descriptor: FormatDescriptor;
	layout: (data: Buffer, sourcePath: string) => CherryGrpLayout | undefined;
}): ArchiveFormat {
	return defineFixedArchive({
		descriptor: options.descriptor,
		// Every kind of this engine writes no word at all, so only the name tells what a file is.
		detection: { signatures: [], priority: -1, extensionFallback: true },
		async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
			if (!GRP_EXTENSION.test(sourcePath)) return false;
			if (source.size < 2n) return false;
			return options.layout(await readStored(source), sourcePath) !== undefined;
		},
		async read(source: ByteSource, sourcePath: string) {
			const stored = await readStored(source);
			const layout = options.layout(stored, sourcePath);
			if (!layout) throw invalidImage("Not a Cherry picture");
			return {
				entries: [grpEntry(layout, sourcePath, source.size)],
				metadata: grpMetadata(layout),
			};
		},
		async openEntry(source: ByteSource, _entry, sourcePath) {
			const stored = await readStored(source);
			const layout = options.layout(stored, sourcePath);
			if (!layout) throw invalidImage("Not a Cherry picture");
			return Readable.from([grpBitmap(stored, layout)]);
		},
	});
}

function grpAttribution(source = "ArcFormats/Cherry/ImageGRP.cs") {
	return [
		{
			project: "GARbro",
			source,
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	];
}

export const cherryGrpImageDescriptor: FormatDescriptor = {
	id: "cherry-grp-image",
	name: "Cherry Soft compressed image",
	extensions: [".grp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: grpAttribution(),
};

export const cherryGrpImageFormat: ArchiveFormat = makeGrpFormat({
	descriptor: cherryGrpImageDescriptor,
	layout: (data) => readCherryGrpLayout(data),
});

export const cherryGrp3ImageDescriptor: FormatDescriptor = {
	id: "cherry-grp3-image",
	name: "Cherry Soft compressed image",
	extensions: [".grp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: grpAttribution(),
};

export const cherryGrp3ImageFormat: ArchiveFormat = makeGrpFormat({
	descriptor: cherryGrp3ImageDescriptor,
	layout: (data) => readGrp3Layout(data),
});

export const cherryGrpEncImageDescriptor: FormatDescriptor = {
	id: "cherry-grp-enc-image",
	name: "Cherry Soft encrypted image",
	extensions: [".grp"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: grpAttribution(),
};

export const cherryGrpEncImageFormat: ArchiveFormat = makeGrpFormat({
	descriptor: cherryGrpEncImageDescriptor,
	layout: (data) => readGrpEncLayout(data),
});
