import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	cherryGrp3ImageFormat,
	cherryGrpEncImageFormat,
	cherryGrpImageFormat,
	decodeGrpImage,
	readCherryGrpLayout,
	readGrp3Layout,
	readGrpEncLayout,
} from "../../packages/formats/src/cherry/grp-image.js";
import { decryptCherryPairs } from "../../packages/formats/src/cherry/pak.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER = 0x18;
const LATER_HEADER = 0x28;
const PALETTE = 0x400;

/** The engine's keying of a byte pair, read the other way round to build a fixture. */
function encryptPairs(plain: Buffer): Buffer {
	const out = Buffer.from(plain);
	for (let at = 0; at + 1 < out.length; at += 2) {
		const lo = out[at] ?? 0;
		const hi = out[at + 1] ?? 0;
		// The engine keys the low byte of a pair with one constant and the high byte with the other, and
		// swaps them; the other way round means the constants swap with them.
		out[at] = (hi ^ 0x33) & 0xff;
		out[at + 1] = (lo ^ 0xcc) & 0xff;
	}
	return out;
}

/** The picture's rows the way the file keeps them: the last row of the picture first. */
function turnedRows(
	pixels: Buffer,
	width: number,
	height: number,
	pixelSize: number,
): Buffer {
	const rows: Buffer[] = [];
	for (let row = height - 1; row >= 0; row -= 1) {
		rows.push(
			pixels.subarray(row * width * pixelSize, (row + 1) * width * pixelSize),
		);
	}
	return Buffer.concat(rows);
}

interface FirstFixture {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The picture's pixels, top down. */
	pixels: Buffer;
	/** The value the head keeps where the reader looks for its hint. */
	offset: number;
	/** The colours of a picture of eight bits, four bytes an entry. */
	palette?: Buffer;
	/** Key the bytes with their own place before they unfold, as the first kind does. */
	keyed: boolean;
	encrypted?: boolean;
	/**
	 * What the head keeps where the first kind writes the length of its packed bytes. An encrypted file has
	 * to keep a value here that does not send it down the second kind's path, which asks for the bytes to
	 * run to the very end of the file.
	 */
	packedSize?: number;
}

function firstFile(options: FirstFixture): Buffer {
	const pixelSize = options.bitsPerPixel >> 3;
	const rows = turnedRows(
		options.pixels,
		options.width,
		options.height,
		pixelSize,
	);
	// The picture always unfolds out of an LZSS stream; the first kind keys those bytes with their place.
	const packed = literalLzssStream(rows);
	const body = options.keyed
		? Buffer.from(packed.map((byte, at) => byte ^ (at & 0xff)))
		: packed;
	const head = Buffer.alloc(HEADER, 0x00);
	head.writeUInt32LE(options.width, 0);
	head.writeUInt32LE(options.height, 4);
	head.writeInt32LE(options.bitsPerPixel, 8);
	head.writeInt32LE(options.packedSize ?? body.length, 0x0c);
	head.writeInt32LE(rows.length, 0x10);
	head.writeInt32LE(options.offset, 0x14);
	const parts: Buffer[] = [head];
	if (options.palette) parts.push(options.palette);
	parts.push(body);
	const file = Buffer.concat(parts);
	if (!options.encrypted) return file;
	// The head is keyed word by word, with the word the reader looks at left as it stands.
	for (const word of [
		{ offset: 0, key: 0xa53cc35a },
		{ offset: 4, key: 0x35421005 },
		{ offset: 0x10, key: 0xcf42355d },
	]) {
		file.writeUInt32LE(
			(file.readUInt32LE(word.offset) ^ word.key) >>> 0,
			word.offset,
		);
	}
	// The picture behind the head is keyed with the engine's pair swap.
	const keyed = encryptPairs(
		Buffer.concat([options.palette ?? Buffer.alloc(0), body]),
	);
	keyed.copy(file, HEADER);
	return file;
}

interface LaterFixture {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The picture's pixels, top down. */
	pixels: Buffer;
	alphaChannel?: boolean;
	palette?: Buffer;
}

function laterFile(options: LaterFixture): Buffer {
	// This kind stores its picture from the top down.
	const rows = options.pixels;
	const body = literalLzssStream(
		Buffer.concat([options.palette ?? Buffer.alloc(0), rows]),
	);
	const head = Buffer.alloc(LATER_HEADER, 0x00);
	head.writeInt32LE(body.length, 0);
	head.writeInt32LE((options.palette?.length ?? 0) + rows.length, 4);
	head.writeInt32LE(0xffff, 8);
	head.writeUInt32LE(options.width, 0x10);
	head.writeUInt32LE(options.height, 0x14);
	head.writeInt32LE(options.bitsPerPixel, 0x18);
	head.writeInt32LE(options.alphaChannel ? 1 : 0, 0x24);
	return Buffer.concat([head, body]);
}

function paletteOf(): Buffer {
	const palette = Buffer.alloc(PALETTE, 0x00);
	for (let i = 1; i < 0xff; i += 1) {
		palette.writeUInt8(i, i * 4);
		palette.writeUInt8((i * 2) & 0xff, i * 4 + 1);
		palette.writeUInt8((i * 3) & 0xff, i * 4 + 2);
	}
	return palette;
}

async function bitmapOf(
	file: Buffer,
	format = cherryGrpImageFormat,
): Promise<Buffer> {
	const archive = await format.open(new BufferByteSource(file), "picture.grp");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

/** Six pixels whose colours climb, three to a row, so a misplaced row shows up. */
function pixels24(): Buffer {
	const out: number[] = [];
	for (let i = 0; i < 6; i += 1) {
		out.push((i * 3) & 0xff, (i * 3 + 1) & 0xff, (i * 3 + 2) & 0xff);
	}
	return Buffer.from(out);
}

describe("Cherry GRP image", () => {
	it("unfolds the first kind and turns its rows the right way up", () => {
		const pixels = pixels24();
		const file = firstFile({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels,
			offset: 0x18,
			keyed: true,
		});
		const layout = readCherryGrpLayout(file);
		if (!layout) throw new Error("the fixture is not a Cherry picture");
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(2);
		expect(layout.headerSize).toBe(HEADER);
		const decoded = decodeGrpImage(file, layout);
		// The rows are read into the last row first, so the picture comes out the right way up.
		expect(decoded.pixels).toEqual(pixels);
		expect(decoded.bottomUp).toBe(false);
	});

	it("reads a picture of eight bits through the colours in front of its bytes", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6]);
		const file = firstFile({
			width: 3,
			height: 2,
			bitsPerPixel: 8,
			pixels,
			offset: 0x418,
			keyed: true,
			palette: paletteOf(),
		});
		const layout = readCherryGrpLayout(file);
		if (!layout) throw new Error("the fixture is not a Cherry picture");
		const decoded = decodeGrpImage(file, layout);
		expect(decoded.palette?.subarray(0, 8)).toEqual(
			Buffer.from([0, 0, 0, 0, 1, 2, 3, 0]),
		);
		expect(decoded.pixels).toEqual(pixels);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(8);
		expect(bitmap.palette.subarray(1 * 4, 1 * 4 + 3)).toEqual(
			Buffer.from([1, 2, 3]),
		);
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("takes a picture whose bytes run to the end of the file as it stands", async () => {
		const pixels = pixels24();
		const rows = turnedRows(pixels, 3, 2, 3);
		const head = Buffer.alloc(HEADER, 0x00);
		head.writeUInt32LE(3, 0);
		head.writeUInt32LE(2, 4);
		head.writeInt32LE(24, 8);
		// Nothing packed, and the offset that says the bytes run to the very end of the file.
		head.writeInt32LE(0, 0x0c);
		head.writeInt32LE(rows.length, 0x10);
		head.writeInt32LE(0x0f0f0f0f, 0x14);
		const file = Buffer.concat([head, rows]);
		const layout = readCherryGrpLayout(file);
		if (!layout) throw new Error("the fixture is not a Cherry picture");
		const decoded = decodeGrpImage(file, layout);
		expect(decoded.bottomUp).toBe(true);
		const bitmap = readBmpImage(await bitmapOf(file));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		// The file keeps its last row first, so the bitmap's first row is the file's last row.
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("reads a picture of the later kind without turning its rows over", () => {
		const pixels = pixels24();
		const file = laterFile({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels,
		});
		const layout = readGrp3Layout(file);
		if (!layout) throw new Error("the fixture is not a later Cherry picture");
		expect(layout.headerSize).toBe(LATER_HEADER);
		expect(layout.offset).toBe(0xffff);
		const decoded = decodeGrpImage(file, layout);
		expect(decoded.pixels).toEqual(pixels);
		// The later kind stores its picture the way it stands, so nothing is turned over.
		expect(decoded.bottomUp).toBe(false);
	});

	it("turns the rows of the first kind over when it unfolds the later way", () => {
		const pixels = pixels24();
		// The same body as the later kind keeps, behind the first kind's head with another offset.
		const body = literalLzssStream(pixels);
		const head = Buffer.alloc(HEADER, 0x00);
		head.writeUInt32LE(3, 0);
		head.writeUInt32LE(2, 4);
		head.writeInt32LE(24, 8);
		head.writeInt32LE(body.length, 0x0c);
		head.writeInt32LE(pixels.length, 0x10);
		head.writeInt32LE(0, 0x14);
		const file = Buffer.concat([head, body]);
		const layout = readCherryGrpLayout(file);
		if (!layout) throw new Error("the fixture is not a Cherry picture");
		const decoded = decodeGrpImage(file, layout);
		// Anything but the later kind's own offset asks for turned over rows.
		expect(decoded.bottomUp).toBe(true);
		expect(decoded.pixels).toEqual(pixels);
	});

	it("keys the head and the bytes of the encrypted kind", async () => {
		const pixels = pixels24();
		const file = firstFile({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels,
			offset: 0x0f0f0f0f,
			keyed: false,
			encrypted: true,
			packedSize: 0,
		});
		// The head is only readable once it is keyed, and the widths it holds before that are wild.
		expect(readGrpEncLayout(file)).toBeDefined();
		expect(readCherryGrpLayout(file)).toBeUndefined();
		const layout = readGrpEncLayout(file);
		if (!layout)
			throw new Error("the fixture is not an encrypted Cherry picture");
		expect(layout.encrypted).toBe(true);
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(2);
		expect(layout.headerSize).toBe(HEADER);
		// The fixture keys the bytes the engine's own way, so the engine's keying turns them back.
		const tail = file.subarray(HEADER);
		expect(decryptCherryPairs(tail, 0, tail.length)).toEqual(
			literalLzssStream(turnedRows(pixels, 3, 2, 3)),
		);
		const decoded = decodeGrpImage(file, layout);
		expect(decoded.pixels.length).toBe(pixels.length);
		// The reader hands the picture back as it stands in the file, with its last row first.
		expect(decoded.bottomUp).toBe(true);
		expect(decoded.pixels).toEqual(turnedRows(pixels, 3, 2, 3));
		const bitmap = readBmpImage(await bitmapOf(file, cherryGrpEncImageFormat));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("reads a picture of thirty two bits with an alpha channel", async () => {
		const pixels = Buffer.from([
			1, 2, 3, 0xa1, 4, 5, 6, 0xa2, 7, 8, 9, 0xa3, 10, 11, 12, 0xa4,
		]);
		const file = laterFile({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			pixels,
			alphaChannel: true,
		});
		const layout = readGrp3Layout(file);
		if (!layout) throw new Error("the fixture is not a later Cherry picture");
		expect(layout.alphaChannel).toBe(true);
		const bitmap = readBmpImage(await bitmapOf(file, cherryGrp3ImageFormat));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.bitsPerPixel).toBe(32);
		expect(bitmap.pixels).toEqual(pixels);
	});

	it("takes every kind of this engine from a name alone", async () => {
		const first = firstFile({
			width: 1,
			height: 1,
			bitsPerPixel: 24,
			pixels: Buffer.from([1, 2, 3]),
			offset: 0,
			keyed: true,
		});
		const later = laterFile({
			width: 1,
			height: 1,
			bitsPerPixel: 24,
			pixels: Buffer.from([1, 2, 3]),
		});
		for (const format of [
			cherryGrpImageFormat,
			cherryGrp3ImageFormat,
			cherryGrpEncImageFormat,
		]) {
			expect(
				await format.detect(new BufferByteSource(later), "picture.bin"),
			).toBe(false);
		}
		expect(
			await cherryGrpImageFormat.detect(
				new BufferByteSource(first),
				"picture.GRP",
			),
		).toBe(true);
		expect(
			await cherryGrp3ImageFormat.detect(
				new BufferByteSource(later),
				"picture.grp",
			),
		).toBe(true);
	});

	it("refuses a picture it cannot read", () => {
		const base = firstFile({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels: pixels24(),
			offset: 0x18,
			keyed: true,
		});
		expect(readCherryGrpLayout(base)).toBeDefined();
		// A depth the engine never writes.
		const wrongDepth = Buffer.from(base);
		wrongDepth.writeInt32LE(16, 8);
		expect(readCherryGrpLayout(wrongDepth)).toBeUndefined();
		// A picture with no width.
		const noWidth = Buffer.from(base);
		noWidth.writeUInt32LE(0, 0);
		expect(readCherryGrpLayout(noWidth)).toBeUndefined();
		// A negative length.
		const negative = Buffer.from(base);
		negative.writeInt32LE(-1, 0x0c);
		expect(readCherryGrpLayout(negative)).toBeUndefined();
		// A later picture whose mark is not there.
		const later = laterFile({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
			pixels: pixels24(),
		});
		const noMark = Buffer.from(later);
		noMark.writeInt32LE(0, 8);
		expect(readGrp3Layout(noMark)).toBeUndefined();
		// A file that stops inside its own head.
		expect(readCherryGrpLayout(base.subarray(0, 8))).toBeUndefined();
		expect(readGrp3Layout(later.subarray(0, LATER_HEADER - 1))).toBeUndefined();
	});
});
