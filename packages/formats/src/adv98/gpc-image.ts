// Format reference: GARBro "Legacy/Adv98/ImageGPC.cs", class `GpcFormat` with the `GpcReader` that unpacks
// through it. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeBmp4 } from "../shared/bmp.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'PC98' and the word the engine signs its name with behind it. */
const SIGNATURE = Buffer.from("PC98", "latin1");
const IDENTIFIER_FIELD = 4;
const IDENTIFIER = ")GPCFILE   \0";
const HEADER_SIZE = 0x20;
const INTERLEAVING_FIELD = 0x10;
const PALETTE_OFFSET_FIELD = 0x14;
const INFO_OFFSET_FIELD = 0x18;
/** The block the dimensions stand in, and where the two places follow it. */
const INFO_HEADER_SIZE = 0x10;
const INFO_WIDTH_FIELD = 0;
const INFO_HEIGHT_FIELD = 2;
const INFO_OFFSET_X_FIELD = 0x0a;
const INFO_OFFSET_Y_FIELD = 0x0c;
/** Four planes of one bit a pixel each make the four bit pixels of the picture. */
const PLANES = 4;
/** The palette: a count, the size of one colour, then a word to each. */
const PALETTE_HEADER_SIZE = 4;
const PALETTE_ELEMENT_SIZE = 2;
const PALETTE_MAXIMUM = 16;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

export interface GpcLayout {
	width: number;
	height: number;
	/** How many rows apart the rows of the packed picture are laid into the picture. */
	interleaving: number;
	paletteOffset: number;
	dataOffset: number;
	offsetX: number;
	offsetY: number;
	paletteColors: number;
	/** The bytes one plane of a row takes, and the bytes a whole row of the packed picture takes. */
	planeStride: number;
	rowSize: number;
}

function invalidImage(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `GpcFormat.ReadMetaData`: the file opens with `PC98` and the engine's own name behind it, then the step its
 * rows are interleaved by, the place its palette stands at and the place a block stands at that carries the
 * dimensions and the two places the picture hangs at. The picture is four bits a pixel, which the reference
 * states rather than reads.
 */
export function readGpcLayout(data: Buffer): GpcLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString(
			"latin1",
			IDENTIFIER_FIELD,
			IDENTIFIER_FIELD + IDENTIFIER.length,
		) !== IDENTIFIER
	) {
		return undefined;
	}
	const interleaving = data.readUInt16LE(INTERLEAVING_FIELD);
	const paletteOffset = data.readUInt32LE(PALETTE_OFFSET_FIELD);
	const infoOffset = data.readUInt32LE(INFO_OFFSET_FIELD);
	const dataOffset = infoOffset + INFO_HEADER_SIZE;
	if (infoOffset + INFO_OFFSET_Y_FIELD + 2 > data.length) return undefined;
	const width = data.readUInt16LE(infoOffset + INFO_WIDTH_FIELD);
	const height = data.readUInt16LE(infoOffset + INFO_HEIGHT_FIELD);
	if (0 === width || 0 === height) return undefined;
	const planeStride = (width + 7) >> 3;
	const rowSize = planeStride * PLANES + 1;
	const total = rowSize * height;
	if (!Number.isSafeInteger(total) || total > LIMIT) return undefined;
	if (paletteOffset + PALETTE_HEADER_SIZE > data.length) return undefined;
	const paletteColors = data.readUInt16LE(paletteOffset);
	if (paletteColors < 1 || paletteColors > PALETTE_MAXIMUM) return undefined;
	if (
		data.readUInt16LE(paletteOffset + 2) !== PALETTE_ELEMENT_SIZE ||
		paletteOffset + PALETTE_HEADER_SIZE + paletteColors * PALETTE_ELEMENT_SIZE >
			data.length
	) {
		return undefined;
	}
	if (dataOffset + total > data.length) return undefined;
	return {
		width,
		height,
		interleaving,
		paletteOffset,
		dataOffset,
		offsetX: data.readInt16LE(infoOffset + INFO_OFFSET_X_FIELD),
		offsetY: data.readInt16LE(infoOffset + INFO_OFFSET_Y_FIELD),
		paletteColors,
		planeStride,
		rowSize,
	};
}

/**
 * `GpcReader.UnpackData`: the packed picture is read a group of eight bytes at a time. A control byte, taken
 * one bit at a time from its highest, says of each group whether it is described at all: a bit of ones is a
 * command byte whose own bits, again from the highest, say of each of the eight bytes whether it is stored,
 * and a bit of nothing leaves the whole group as nothing. A stream that ends leaves the rest of the picture
 * as it was, which is how the reference stops.
 */
function unpackGpcData(data: Buffer, start: number, output: Buffer): void {
	let at = start;
	let target = 0;
	let control = 0;
	let mask = 0;
	while (target < output.length) {
		if (0 === mask) {
			const next = data[at];
			if (undefined === next) break;
			at += 1;
			control = next;
			mask = 0x80;
		}
		if (0 !== (control & mask)) {
			const command = data[at];
			if (undefined === command) {
				throw invalidImage("The packed picture ends inside a group");
			}
			at += 1;
			for (let bit = 0x80; bit !== 0; bit >>= 1) {
				if (0 === (command & bit)) continue;
				const value = data[at];
				if (undefined === value) {
					throw invalidImage("The packed picture ends inside a group");
				}
				at += 1;
				if (target >= output.length) {
					throw invalidImage("A group of the picture outgrows it");
				}
				output[target] = value;
				target += 1;
			}
		}
		// A group the control byte left alone is eight bytes of nothing, which the picture already holds.
		target += 8;
		mask >>= 1;
	}
}

/**
 * `GpcReader.RestoreData`: every row of the packed picture opens with the step its own bytes are woven by, and
 * behind it the bytes of the row are accumulated with an exclusive or along each of that many threads. Every
 * row behind the first is then accumulated the same way with the row above it, byte for byte, over as many
 * bytes as the reference rounds down to a whole word -- so the bytes past the last whole word of a row are
 * left as they stand.
 */
function restoreGpcData(data: Buffer, layout: GpcLayout): void {
	for (let row = 0; row < layout.height; row += 1) {
		const start = row * layout.rowSize;
		const interleave = data[start] ?? 0;
		if (0 !== interleave) {
			for (let thread = 0; thread < interleave; thread += 1) {
				let last = 0;
				for (let at = 1 + thread; at < layout.rowSize; at += interleave) {
					last = (data[start + at] ?? 0) ^ last;
					data[start + at] = last;
				}
			}
		}
		if (row > 0) {
			const above = start - layout.rowSize;
			const length = (layout.rowSize - 1) & -4;
			for (let at = 1; at <= length; at += 1) {
				data[start + at] = (data[start + at] ?? 0) ^ (data[above + at] ?? 0);
			}
		}
	}
}

/**
 * `GpcReader.ConvertTo8bpp`: the four planes of a row are woven into pixels of four bits, the first of the
 * four becoming the highest bit of a pixel and the fourth its lowest, and a byte of a plane becoming four
 * bytes of the picture -- eight pixels -- the pair of pixels from the highest bits of the planes standing
 * first in their byte. The rows of the packed picture land `interleaving` rows apart in the picture, and a
 * walk that runs past the end of it starts again one row further down, which is the reference's own wrap.
 */
function convertGpc(data: Buffer, pixels: Buffer, layout: GpcLayout): void {
	const stride = layout.planeStride * PLANES;
	const step = stride * layout.interleaving;
	let sourceRow = 1;
	let destinationRow = 0;
	let pass = 0;
	for (let row = 0; row < layout.height; row += 1) {
		if (destinationRow >= pixels.length) {
			pass += 1;
			destinationRow = stride * pass;
		}
		let p0 = sourceRow;
		let p1 = p0 + layout.planeStride;
		let p2 = p1 + layout.planeStride;
		let p3 = p2 + layout.planeStride;
		sourceRow = p3 + layout.planeStride + 1;
		let target = destinationRow;
		for (let at = layout.planeStride; at > 0; at -= 1) {
			const b0 = data[p0] ?? 0;
			const b1 = data[p1] ?? 0;
			const b2 = data[p2] ?? 0;
			const b3 = data[p3] ?? 0;
			p0 += 1;
			p1 += 1;
			p2 += 1;
			p3 += 1;
			for (let pair = 0; pair < 4; pair += 1) {
				const j = pair * 2;
				const high =
					(((b0 << j) & 0x80) >> 3) |
					(((b1 << j) & 0x80) >> 2) |
					(((b2 << j) & 0x80) >> 1) |
					((b3 << j) & 0x80);
				const low =
					(((b0 << j) & 0x40) >> 6) |
					(((b1 << j) & 0x40) >> 5) |
					(((b2 << j) & 0x40) >> 4) |
					(((b3 << j) & 0x40) >> 3);
				if (target >= pixels.length) {
					throw invalidImage("A row of the picture outgrows it");
				}
				pixels[target] = (high | low) & 0xff;
				target += 1;
			}
		}
		destinationRow += step;
	}
}

export function decodeGpc(
	data: Buffer,
	layout: GpcLayout,
): { pixels: Buffer; palette: Buffer; stride: number } {
	const palette: Buffer = Buffer.alloc(PALETTE_MAXIMUM * 3, 0x00);
	for (let index = 0; index < layout.paletteColors; index += 1) {
		const word = data.readUInt16LE(
			layout.paletteOffset + PALETTE_HEADER_SIZE + index * PALETTE_ELEMENT_SIZE,
		);
		// Every colour is four bits to a part, which the reference widens by seventeen.
		palette[index * 3] = ((word >> 4) & 0x0f) * 0x11;
		palette[index * 3 + 1] = ((word >> 8) & 0x0f) * 0x11;
		palette[index * 3 + 2] = (word & 0x0f) * 0x11;
	}
	const stored: Buffer = Buffer.alloc(layout.rowSize * layout.height, 0x00);
	unpackGpcData(data, layout.dataOffset, stored);
	restoreGpcData(stored, layout);
	const stride = layout.planeStride * PLANES;
	const pixels: Buffer = Buffer.alloc(stride * layout.height, 0x00);
	convertGpc(stored, pixels, layout);
	return { pixels, palette, stride };
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const adv98GpcImageDescriptor: FormatDescriptor = {
	id: "adv98-gpc-image",
	name: "Adv98 engine image",
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
			source: "Legacy/Adv98/ImageGPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const adv98GpcImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: adv98GpcImageDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readGpcLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readGpcLayout(stored);
		if (!layout) {
			throw invalidImage("Not an Adv98 picture");
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
					bitsPerPixel: 4,
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
				bitsPerPixel: 4,
				interleaving: layout.interleaving,
				offsetX: layout.offsetX,
				offsetY: layout.offsetY,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readGpcLayout(stored);
		if (!layout) {
			throw invalidImage("Not an Adv98 picture");
		}
		const { pixels, palette, stride } = decodeGpc(stored, layout);
		// The rows of the picture are written with a length of their own, while a bitmap takes them packed.
		const packedStride = (layout.width + 1) >> 1;
		const rows: Buffer[] = [];
		for (let row = 0; row < layout.height; row += 1) {
			rows.push(pixels.subarray(row * stride, row * stride + packedStride));
		}
		// `ImageData.Create` fills the rows top down, so the bitmap gets a negative height.
		return Readable.from([
			writeBmp4(
				layout.width,
				layout.height,
				Buffer.concat(rows),
				palette,
				false,
			),
		]);
	},
});
