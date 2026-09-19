// Format reference: GARbro "Legacy/AyPio/ImagePDT.cs", classes `PdtFormat`, `PdtMetaData` and `Pdt4Reader`
// (a UK2 engine picture of four bits: its colours stand in sixteen words of the head, its four planes stand
// one behind the other and are walked in pairs of rows, and the places of the four planes stand together in
// every byte of the picture). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** The names the reference registers the format by; it declares no word of its own. */
const EXTENSIONS = ["pdt", "anm"];
/** The byte the reference tells a picture of this engine by. */
const SIGNATURE_BYTE = 0x34;
/** The bytes that name the two walks of a plane. */
const RLE_1_FIELD = 0x21;
const RLE_2_FIELD = 0x22;
/** The places of the picture: how far its left edge and its top edge stand from nought. */
const LEFT_FIELD = 0x23;
const TOP_FIELD = 0x25;
const RIGHT_FIELD = 0x27;
const BOTTOM_FIELD = 0x29;
/** The colours of the picture and where the planes behind begin. */
const PALETTE_FIELD = 0x01;
const PALETTE_COLORS = 16;
const PLANES_FIELD = 0x2b;
/** The bounds the reference holds a picture of this engine to. */
const MAXIMUM_WIDTH = 2048;
const MAXIMUM_HEIGHT = 512;

export interface Pdt4Layout {
	width: number;
	height: number;
	/** How far the left edge and the top edge of the picture stand from nought. */
	offsetX: number;
	offsetY: number;
	/** The two bytes that name the walks of a plane. */
	rle1: number;
	rle2: number;
}

function invalidPicture(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PdtFormat.ReadMetaData`: the first byte of the file is thirty four; the two bytes at `0x21` name the walks
 * of a plane and the four words behind them name the left, the top, the right and the bottom of the picture.
 * The width of the picture stands in the places of the bits between its left and its right edge — eight
 * places for every byte — and the height in the pairs of rows between its top and its bottom edge.
 */
export function readPdt4Layout(
	data: Buffer,
	fileLength = data.length,
): Pdt4Layout | undefined {
	if (data.length < PLANES_FIELD) return undefined;
	if ((data[0] ?? 0) !== SIGNATURE_BYTE) return undefined;
	if (fileLength < PLANES_FIELD) return undefined;
	const left = data.readUInt16LE(LEFT_FIELD);
	const top = data.readUInt16LE(TOP_FIELD);
	const right = data.readUInt16LE(RIGHT_FIELD);
	const bottom = data.readUInt16LE(BOTTOM_FIELD);
	const width = (right - left + 1) << 3;
	const height = (((bottom - top) >> 1) + 1) << 1;
	if (width <= 0 || height <= 0) return undefined;
	if (width > MAXIMUM_WIDTH || height > MAXIMUM_HEIGHT) return undefined;
	return {
		width,
		height,
		offsetX: left << 3,
		offsetY: top,
		rle1: data[RLE_1_FIELD] ?? 0,
		rle2: data[RLE_2_FIELD] ?? 0,
	};
}

/**
 * `Pdt4Reader.ReadPalette`: sixteen colours of four bits each stand in a word apiece: the lowest four places
 * of the word are the blue of the colour, the four behind them the red and the four behind those the green,
 * every part of four places standing for thirty four places of a colour of eight bits.
 */
export function readPdtPalette(data: Buffer): Buffer {
	const palette = Buffer.alloc(PALETTE_COLORS * 3, 0x00);
	for (let entry = 0; entry < PALETTE_COLORS; entry += 1) {
		const rgb = data.readUInt16LE(PALETTE_FIELD + entry * 2);
		palette[entry * 3] = ((rgb >> 4) & 0xf) * 0x11;
		palette[entry * 3 + 1] = ((rgb >> 8) & 0xf) * 0x11;
		palette[entry * 3 + 2] = (rgb & 0xf) * 0x11;
	}
	return palette;
}

/**
 * `Pdt4Reader.UnpackPlane`: the plane is walked a byte of a row at a time — the bytes of a row standing one
 * after another, a row behind the last byte of the row before it — and every step of the walk gives a pair of
 * rows of that byte. A byte that is neither of the two the head names is the first row of the pair and the
 * byte behind it is the second; a byte that is the first of them names how many pairs stand there and the two
 * bytes of the pair behind it; and a byte that is the second names how many pairs stand there and the one
 * byte the two rows of every pair stand for.
 */
function unpackPdtPlane(
	data: Buffer,
	cursor: { position: number },
	layout: { rle1: number; rle2: number },
	stride: number,
	rows: number,
	output: Buffer,
	column: number,
): void {
	let at = column;
	let row = 0;
	while (row < rows) {
		let count = 1;
		let p0: number;
		let p1: number;
		const control = readPdtByte(data, cursor);
		if (control === layout.rle1) {
			count = readPdtByte(data, cursor);
			p0 = readPdtByte(data, cursor);
			p1 = readPdtByte(data, cursor);
		} else if (control === layout.rle2) {
			count = readPdtByte(data, cursor);
			p1 = readPdtByte(data, cursor);
			p0 = p1;
		} else {
			p0 = control;
			p1 = readPdtByte(data, cursor);
		}
		while (count > 0) {
			count -= 1;
			if (at >= output.length || at + stride >= output.length) {
				throw invalidPicture("UK2 picture stands beyond its own plane");
			}
			output[at] = p0;
			at += stride;
			output[at] = p1;
			at += stride;
			row += 1;
		}
	}
}

function readPdtByte(data: Buffer, cursor: { position: number }): number {
	if (cursor.position >= data.length) {
		throw invalidPicture("UK2 picture is cut short of its planes");
	}
	const value = data[cursor.position] ?? 0;
	cursor.position += 1;
	return value;
}

/**
 * `Pdt4Reader.FlattenPlanes`: the places of the four planes stand together in every byte of the picture — the
 * byte of the first plane in the highest place of a colour, the second plane behind it and so on — and every
 * byte of a plane carries the colours of eight places of a row, two colours of four places standing in every
 * byte of the picture.
 */
export function flattenPdtPlanes(planes: Buffer[]): Buffer {
	const size = planes[0]?.length ?? 0;
	const output = Buffer.alloc(size * 4, 0x00);
	let at = 0;
	for (let src = 0; src < size; src += 1) {
		const b0 = planes[0]?.[src] ?? 0;
		const b1 = planes[1]?.[src] ?? 0;
		const b2 = planes[2]?.[src] ?? 0;
		const b3 = planes[3]?.[src] ?? 0;
		for (let place = 0; place < 8; place += 2) {
			let pixel =
				(((b0 << place) & 0x80) >> 3) |
				(((b1 << place) & 0x80) >> 2) |
				(((b2 << place) & 0x80) >> 1) |
				((b3 << place) & 0x80);
			pixel |=
				(((b0 << place) & 0x40) >> 6) |
				(((b1 << place) & 0x40) >> 5) |
				(((b2 << place) & 0x40) >> 4) |
				(((b3 << place) & 0x40) >> 3);
			output[at] = pixel & 0xff;
			at += 1;
		}
	}
	return output;
}

/**
 * `Pdt4Reader.Unpack`: the four planes stand one behind the other from `0x2B` and every plane stands as many
 * rows of the picture as the picture is high, one byte for every eight places of a row.
 */
export function decodePdt(data: Buffer, layout: Pdt4Layout): Buffer {
	const stride = layout.width >> 3;
	const rows = layout.height >> 1;
	const planeSize = stride * layout.height;
	const cursor = { position: PLANES_FIELD };
	const planes: Buffer[] = [];
	for (let plane = 0; plane < 4; plane += 1) {
		const output: Buffer = Buffer.alloc(planeSize, 0x00);
		for (let column = 0; column < stride; column += 1) {
			unpackPdtPlane(data, cursor, layout, stride, rows, output, column);
		}
		planes.push(output);
	}
	const pixels = flattenPdtPlanes(planes);
	return writeBmp4(layout.width, layout.height, pixels, readPdtPalette(data));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aypioPdtImageDescriptor: FormatDescriptor = {
	id: "aypio-pdt-image",
	name: "UK2 engine image format",
	extensions: EXTENSIONS,
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
			source: "Legacy/AyPio/ImagePDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aypioPdtImageFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aypioPdtImageDescriptor,
	// The reference registers no word at all, only the two names of the format.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(PLANES_FIELD)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, PLANES_FIELD));
			return readPdt4Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPdt4Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a UK2 engine picture");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "bmp"),
				offset: BigInt(PLANES_FIELD),
				size: source.size - BigInt(PLANES_FIELD),
				compressed: true,
				metadata: {
					type: "image",
					width: layout.width,
					height: layout.height,
					bitsPerPixel: 4,
					offsetX: layout.offsetX,
					offsetY: layout.offsetY,
				},
			}),
			// The planes are gathered into a bitmap of four bits.
		};
		return {
			entries: [entry],
			metadata: { image: "bmp", bitsPerPixel: 4 },
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readPdt4Layout(stored, Number(source.size));
		if (!layout) throw invalidPicture("Not a UK2 engine picture");
		return Readable.from([decodePdt(stored, layout)]);
	},
});
