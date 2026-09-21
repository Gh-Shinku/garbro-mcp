// Format reference: GARBro "ArcFormats/C4/ImageGD.cs", classes `GdFormat` and `XexGdFormat` with the
// `GdReader` they share. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { writeBmp24 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The engine's words: a digit that names the size of the picture, and a byte behind it. */
const GD2_SIGNATURE = Buffer.from("GD2\u001a", "latin1");
const GD3_SIGNATURE = Buffer.from("GD3\u001a", "latin1");
const GD2_WIDTH = 640;
const GD2_HEIGHT = 480;
const GD3_WIDTH = 800;
const GD3_HEIGHT = 600;
/** The byte that names how the picture is stored stands behind a fixed number of pixels of one column. */
const COMPRESSION_COLUMNS = 10;
/** Rows the head counts down, and the byte the reader steps over beside the compression one. */
const COMPRESSION_ROW_SKIP = 1;
const COMPRESSION_TAIL = 2;
/** The engine never writes a picture in another depth. */
const BITS_PER_PIXEL = 24;
const PIXEL_SIZE = 3;
/** A picture stored in the packed way begins as this colour, which the fill pass behind it replaces. */
const PACKED_FILL = 0xff;
/** The frame a back reference of the packed away kind reads from, and where its first byte lands. */
const FRAME_SIZE = 0x10000;
const FRAME_START = 1;
const MIN_MATCH = 3;
/** A skip encoded in the long form climbs in steps of this size before it is written out. */
const LONG_SKIP_BASE = 3;
const LONG_SKIP_LIMIT = 24;
/** The extension the engine's own reader insists on. */
const GD_EXTENSION = /\.gd$/i;

export type GdCompression = "b" | "l" | "p";

export interface GdLayout {
	width: number;
	height: number;
	compression: GdCompression;
	/** Where the picture's own bytes begin. */
	dataOffset: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function compressionOf(code: number): GdCompression | undefined {
	const character = String.fromCharCode(code);
	return "b" === character || "l" === character || "p" === character
		? character
		: undefined;
}

/**
 * `GdFormat.ReadMetaData`: the head is the engine's word, which carries both the kind of picture and its
 * size, and the byte that tells how the picture is stored stands behind a fixed number of pixels. The
 * reference works that place out as `4 + 3 * (width / 10) * (height / 10 - 1)`, with whole number division,
 * and then reads one byte and sets its own offset to the place **two** bytes behind that byte's start.
 */
export function readGdLayout(data: Buffer): GdLayout | undefined {
	if (data.length < 4) return undefined;
	if (data[3] !== 0x1a) return undefined;
	const tag = data.toString("latin1", 0, 3);
	const size =
		"GD2" === tag
			? { width: GD2_WIDTH, height: GD2_HEIGHT }
			: "GD3" === tag
				? { width: GD3_WIDTH, height: GD3_HEIGHT }
				: undefined;
	if (!size) return undefined;
	const at =
		4 +
		PIXEL_SIZE *
			Math.trunc(size.width / COMPRESSION_COLUMNS) *
			(Math.trunc(size.height / COMPRESSION_COLUMNS) - COMPRESSION_ROW_SKIP);
	if (at + COMPRESSION_TAIL > data.length) return undefined;
	const compression = compressionOf(data[at] ?? 0);
	if (!compression) return undefined;
	return {
		...size,
		compression,
		dataOffset: at + COMPRESSION_TAIL,
	};
}

/**
 * `XexGdFormat.ReadMetaData`: the engine of Completes writes the same pictures without any word at all, and
 * the reference only takes such a file when it is named `.GD`. Its first two bytes are the way the picture
 * is stored and a byte of the engine's mark, and the size is the smaller one.
 */
export function readXexGdLayout(
	data: Buffer,
	sourcePath: string,
): GdLayout | undefined {
	if (!GD_EXTENSION.test(sourcePath)) return undefined;
	if (data.length < 2 || data[1] !== 0x1a) return undefined;
	const compression = compressionOf(data[0] ?? 0);
	// The reference takes the two packed ways only, never a stored picture.
	if (!compression || "b" === compression) return undefined;
	return {
		width: GD2_WIDTH,
		height: GD2_HEIGHT,
		compression,
		dataOffset: 2,
	};
}

function pictureLength(layout: GdLayout): number {
	return layout.width * layout.height * PIXEL_SIZE;
}

/** `GdReader.Unpack` for a picture kept as it stands. */
function unpackStored(data: Buffer, layout: GdLayout): Buffer {
	const length = pictureLength(layout);
	if (layout.dataOffset + length > data.length) {
		throw invalidImage("A stored picture is shorter than its size");
	}
	return Buffer.from(
		data.subarray(layout.dataOffset, layout.dataOffset + length),
	);
}

/**
 * `GdReader.UnpackL`: a bit at a time. A set bit is a byte of the picture, which is also kept in a frame of
 * sixty four thousand bytes; a clear bit is an offset of sixteen bits and a run of four bits, which stands
 * for three to eighteen bytes copied out of that frame, each of them kept as well. The frame's first byte
 * is stepped over, so the first byte of the picture lands at index one.
 */
export function unpackGdPackedAway(data: Buffer, layout: GdLayout): Buffer {
	const output: Buffer = Buffer.alloc(pictureLength(layout), 0x00);
	const frame: Buffer = Buffer.alloc(FRAME_SIZE, 0x00);
	const bits = new MsbBitReader(data, layout.dataOffset);
	let destination = 0;
	let framePosition = FRAME_START;
	while (destination < output.length) {
		const bit = bits.tryReadBits(1);
		if (-1 === bit) break;
		if (0 !== bit) {
			const value = bits.tryReadBits(8);
			if (-1 === value) break;
			output[destination] = value;
			destination += 1;
			frame[framePosition & 0xffff] = value;
			framePosition += 1;
			continue;
		}
		let offset = bits.tryReadBits(16);
		const count = bits.tryReadBits(4);
		if (-1 === offset || -1 === count) break;
		let remaining = count + MIN_MATCH;
		while (remaining > 0) {
			remaining -= 1;
			if (destination >= output.length) {
				// The reference would run off the end of its own buffer here.
				throw invalidImage("A run of the picture reaches past its end");
			}
			const value = frame[offset & 0xffff] ?? 0;
			output[destination] = value;
			destination += 1;
			frame[framePosition & 0xffff] = value;
			framePosition += 1;
			offset += 1;
		}
	}
	return output;
}

/**
 * `GdReader.UnpackP`: runs of pixels over a picture that begins as one solid colour. A run begins with two
 * bits, which name how many pixels to step over, with two longer forms behind them; the pixel that follows
 * is written whole, and then a walk of two bit steps may carry that same colour to neighbouring rows - by a
 * place above or below the column it was written in. Every place the runs left untouched keeps the fill
 * colour, and the pass at the end gives each of those places the colour of the pixel before it.
 */
export function unpackGdPackedTogether(data: Buffer, layout: GdLayout): Buffer {
	const output: Buffer = Buffer.alloc(pictureLength(layout), PACKED_FILL);
	const bits = new MsbBitReader(data, layout.dataOffset);
	const width = layout.width;
	let destination = 0;
	while (destination < output.length) {
		let count = bits.tryReadBits(2);
		if (-1 === count) break;
		if (2 === count) {
			const more = bits.tryReadBits(2);
			if (-1 === more) break;
			count = more + 2;
		} else if (3 === count) {
			let steps = LONG_SKIP_BASE;
			let bit = bits.tryReadBits(1);
			while (bit > 0) {
				steps += 1;
				if (steps >= LONG_SKIP_LIMIT) break;
				bit = bits.tryReadBits(1);
			}
			if (-1 === bit || steps >= LONG_SKIP_LIMIT) break;
			const value = bits.tryReadBits(steps);
			if (-1 === value) break;
			count = ((1 << steps) | value) - 2;
		}
		destination += PIXEL_SIZE * count;
		if (destination + PIXEL_SIZE > output.length) {
			throw invalidImage("A run of the picture reaches past its end");
		}
		output[destination] = bits.tryReadBits(8) & 0xff;
		output[destination + 1] = bits.tryReadBits(8) & 0xff;
		output[destination + 2] = bits.tryReadBits(8) & 0xff;
		if (bits.tryReadBits(1) > 0) {
			let copy = destination;
			for (;;) {
				const control = bits.tryReadBits(2);
				if (0 === control) {
					if (bits.tryReadBits(1) <= 0) break;
					const up = bits.tryReadBits(1);
					if (-1 === up) break;
					copy += (up > 0 ? width + 2 : width - 2) * PIXEL_SIZE;
				} else if (1 === control) {
					copy += (width - 1) * PIXEL_SIZE;
				} else if (2 === control) {
					copy += width * PIXEL_SIZE;
				} else if (3 === control) {
					copy += (width + 1) * PIXEL_SIZE;
				} else {
					break;
				}
				if (copy < 0 || copy + PIXEL_SIZE > output.length) {
					throw invalidImage("A copy reaches outside the picture");
				}
				output[copy] = output[destination] ?? 0;
				output[copy + 1] = output[destination + 1] ?? 0;
				output[copy + 2] = output[destination + 2] ?? 0;
			}
		}
		destination += PIXEL_SIZE;
	}
	let blue = 0;
	let green = 0;
	let red = 0;
	for (let at = 0; at < output.length; at += PIXEL_SIZE) {
		if (
			PACKED_FILL === output[at] &&
			PACKED_FILL === output[at + 1] &&
			PACKED_FILL === output[at + 2]
		) {
			output[at] = blue;
			output[at + 1] = green;
			output[at + 2] = red;
		} else {
			blue = output[at] ?? 0;
			green = output[at + 1] ?? 0;
			red = output[at + 2] ?? 0;
		}
	}
	return output;
}

/** `GdReader.Unpack`: the way the picture is stored picks one of the three walks. */
export function unpackGdPicture(data: Buffer, layout: GdLayout): Buffer {
	if ("b" === layout.compression) return unpackStored(data, layout);
	if ("l" === layout.compression) return unpackGdPackedAway(data, layout);
	return unpackGdPackedTogether(data, layout);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function gdMetadata(layout: GdLayout) {
	return {
		image: "bmp",
		width: layout.width,
		height: layout.height,
		bitsPerPixel: BITS_PER_PIXEL,
		compression: layout.compression,
	};
}

function gdEntry(
	layout: GdLayout,
	sourcePath: string,
	size: bigint,
): FixedEntry {
	return {
		...createFixedEntry({
			id: 0,
			path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "bmp"),
			offset: 0n,
			size,
			compressed: "b" !== layout.compression,
			metadata: {
				type: "image",
				width: layout.width,
				height: layout.height,
				bitsPerPixel: BITS_PER_PIXEL,
			},
		}),
		// The picture is reserialised as a bitmap, which need not be the stored length.
		sizeKnown: false,
	};
}

export const c4GdImageDescriptor: FormatDescriptor = {
	id: "c4-gd-image",
	name: "C4 image",
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
			source: "ArcFormats/C4/ImageGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const c4GdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: c4GdImageDescriptor,
	detection: {
		signatures: [{ bytes: GD2_SIGNATURE }, { bytes: GD3_SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 4n) return false;
		return readGdLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readGdLayout(stored);
		if (!layout) throw invalidImage("Not a C4 picture");
		return {
			entries: [gdEntry(layout, sourcePath, source.size)],
			metadata: gdMetadata(layout),
		};
	},
	async openEntry(source: ByteSource, _entry, _sourcePath) {
		const stored = await readStored(source);
		const layout = readGdLayout(stored);
		if (!layout) throw invalidImage("Not a C4 picture");
		return Readable.from([
			// The engine stores its picture from the bottom up, so the bitmap keeps a positive height.
			writeBmp24(
				layout.width,
				layout.height,
				unpackGdPicture(stored, layout),
				true,
			),
		]);
	},
});

export const c4XexGdImageDescriptor: FormatDescriptor = {
	id: "c4-xex-gd-image",
	name: "Complets XEX image",
	extensions: [".gd"],
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
			source: "ArcFormats/C4/ImageGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const c4XexGdImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: c4XexGdImageDescriptor,
	// The engine's own reader writes no word at all, so only the name of the file tells what it is.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath || source.size < 2n) return false;
		return readXexGdLayout(await readStored(source), sourcePath) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readXexGdLayout(stored, sourcePath);
		if (!layout) throw invalidImage("Not a Complets XEX picture");
		return {
			entries: [gdEntry(layout, sourcePath, source.size)],
			metadata: gdMetadata(layout),
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath) {
		const stored = await readStored(source);
		const layout = readXexGdLayout(stored, sourcePath);
		if (!layout) throw invalidImage("Not a Complets XEX picture");
		return Readable.from([
			writeBmp24(
				layout.width,
				layout.height,
				unpackGdPicture(stored, layout),
				true,
			),
		]);
	},
});
