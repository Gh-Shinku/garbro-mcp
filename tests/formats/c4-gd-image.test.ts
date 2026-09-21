import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	c4GdImageFormat,
	c4XexGdImageFormat,
	readGdLayout,
	readXexGdLayout,
	unpackGdPicture,
} from "../../packages/formats/src/c4/gd-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const WIDTH = 640;
const HEIGHT = 480;
const PICTURE = WIDTH * HEIGHT * 3;
/** The byte that names the way the picture is stored stands behind this many bytes of column pixels. */
const COLUMN_SKIP = 3 * 64 * 47;
const COMPRESSION_AT = 4 + COLUMN_SKIP;
const DATA_AT = COMPRESSION_AT + 2;

/** A bit stream written the way the reference reads it: most significant bit of each byte first. */
class BitWriter {
	#bits: number[] = [];

	bit(value: number): this {
		this.#bits.push(value & 1);
		return this;
	}

	bits(value: number, count: number): this {
		for (let shift = count - 1; shift >= 0; shift -= 1) {
			this.#bits.push((value >> shift) & 1);
		}
		return this;
	}

	byte(value: number): this {
		return this.bits(value, 8);
	}

	toBuffer(): Buffer {
		const out = Buffer.alloc(Math.ceil(this.#bits.length / 8), 0x00);
		this.#bits.forEach((bit, index) => {
			if (bit) out[index >> 3] = (out[index >> 3] ?? 0) | (0x80 >> (index & 7));
		});
		return out;
	}
}

/** A `GD2` file: the word, the column pixels the reader steps over, the way, and the picture's bytes. */
function gdFile(compression: string, body: Buffer, tag = "GD2"): Buffer {
	const file = Buffer.alloc(DATA_AT + body.length, 0x00);
	file.write(tag, 0, "latin1");
	// The word ends with a byte of the engine's own.
	file[3] = 0x1a;
	file.write(compression, COMPRESSION_AT, "latin1");
	body.copy(file, DATA_AT);
	return file;
}

/** A file of the Completes engine: two bytes, and then the picture. */
function xexFile(compression: string, body: Buffer, mark = 0x1a): Buffer {
	const file = Buffer.alloc(2 + body.length, 0x00);
	file.write(compression, 0, "latin1");
	file[1] = mark;
	body.copy(file, 2);
	return file;
}

async function bitmapOf(
	file: Buffer,
	name: string,
	format = c4GdImageFormat,
): Promise<Buffer> {
	const archive = await format.open(new BufferByteSource(file), name);
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

describe("C4 GD image", () => {
	it("reads a picture kept as it stands and turns its rows over", async () => {
		const body = Buffer.alloc(PICTURE, 0x11);
		// A marker in the row the file stores first, which is the picture's last row.
		body.fill(0x99, 0, 3);
		const file = gdFile("b", body);
		const layout = readGdLayout(file);
		if (!layout) throw new Error("the fixture is not a C4 picture");
		expect(layout.width).toBe(640);
		expect(layout.height).toBe(480);
		expect(layout.compression).toBe("b");
		expect(layout.dataOffset).toBe(DATA_AT);
		const pixels = unpackGdPicture(file, layout);
		expect(pixels.length).toBe(PICTURE);
		// The reader hands the picture back the way the engine stores it: its last row first.
		expect(pixels.subarray(0, 3)).toEqual(Buffer.from([0x99, 0x99, 0x99]));
		expect(pixels.subarray(PICTURE - 3)).toEqual(
			Buffer.from([0x11, 0x11, 0x11]),
		);
		const bitmap = readBmpImage(await bitmapOf(file, "picture.GD2"));
		if (!bitmap) throw new Error("the picture is not a bitmap");
		expect(bitmap.width).toBe(640);
		expect(bitmap.height).toBe(480);
		expect(bitmap.bitsPerPixel).toBe(24);
		// The engine stores its picture from the bottom up, so the marker ends up at the start of the last row.
		expect(bitmap.pixels.subarray(0, 3)).toEqual(
			Buffer.from([0x11, 0x11, 0x11]),
		);
		const lastRow = PICTURE - WIDTH * 3;
		expect(bitmap.pixels.subarray(lastRow, lastRow + 3)).toEqual(
			Buffer.from([0x99, 0x99, 0x99]),
		);
		expect(bitmap.pixels.subarray(lastRow + 3, lastRow + 6)).toEqual(
			Buffer.from([0x11, 0x11, 0x11]),
		);
	});

	it("names the larger size for the later word", () => {
		const file = gdFile("b", Buffer.alloc(PICTURE, 0x00), "GD3");
		// The byte that names the way stands behind another column count for this size.
		file.write("b", 4 + 3 * 80 * 59, "latin1");
		const layout = readGdLayout(file);
		if (!layout) throw new Error("the fixture is not a C4 picture");
		expect(layout.width).toBe(800);
		expect(layout.height).toBe(600);
		expect(layout.dataOffset).toBe(4 + 3 * 80 * 59 + 2);
	});

	it("unfolds a picture whose bytes are packed away", () => {
		const stream = new BitWriter()
			.bit(1)
			.byte(0xaa)
			.bit(1)
			.byte(0xbb)
			.bit(1)
			.byte(0xcc)
			// Three bytes read back out of the frame, whose first byte stands at index one.
			.bit(0)
			.bits(1, 16)
			.bits(0, 4);
		const file = gdFile("l", stream.toBuffer());
		const layout = readGdLayout(file);
		if (!layout) throw new Error("the fixture is not a C4 picture");
		const pixels = unpackGdPicture(file, layout);
		expect(pixels.subarray(0, 12)).toEqual(
			Buffer.from([
				0xaa, 0xbb, 0xcc, 0xaa, 0xbb, 0xcc, 0x00, 0x00, 0x00, 0, 0, 0,
			]),
		);
	});

	it("gives a picture that packs its colours together the colour before each place", () => {
		// Nothing at all is stored, so every place keeps the fill colour and the pass behind it gives each
		// one the colour that came before, which at the very first place is nothing.
		const file = gdFile("p", Buffer.alloc(0, 0x00));
		const layout = readGdLayout(file);
		if (!layout) throw new Error("the fixture is not a C4 picture");
		const pixels = unpackGdPicture(file, layout);
		expect(pixels.subarray(0, 6)).toEqual(Buffer.alloc(6, 0x00));
		expect(pixels.every((byte) => 0 === byte)).toBe(true);
	});

	it("carries a packed colour to the row below it", () => {
		const stream = new BitWriter()
			// A pixel with no place skipped, then a copy one row down.
			.bits(0, 2)
			.byte(0x10)
			.byte(0x20)
			.byte(0x30)
			.bit(1)
			.bits(2, 2)
			// The walk ends with a control that asks for nothing and then a bit that is clear.
			.bits(0, 2)
			.bit(0)
			// A second pixel beside the first, which is carried nowhere.
			.bits(0, 2)
			.byte(0x40)
			.byte(0x50)
			.byte(0x60)
			.bit(0);
		const file = gdFile("p", stream.toBuffer());
		const layout = readGdLayout(file);
		if (!layout) throw new Error("the fixture is not a C4 picture");
		const pixels = unpackGdPicture(file, layout);
		const row = WIDTH * 3;
		expect(pixels.subarray(0, 3)).toEqual(Buffer.from([0x10, 0x20, 0x30]));
		expect(pixels.subarray(3, 6)).toEqual(Buffer.from([0x40, 0x50, 0x60]));
		// The copy put the first colour a row below it; a port that dropped that walk would leave the place
		// at its fill colour, which the pass behind the runs would then give the colour of nothing.
		expect(pixels.subarray(row, row + 3)).toEqual(
			Buffer.from([0x10, 0x20, 0x30]),
		);
		// The pass behind the runs walks from the very start, so the place behind the copied one is given
		// the colour it just passed, and only the places behind the second pixel take the second colour.
		expect(pixels.subarray(row + 3, row + 6)).toEqual(
			Buffer.from([0x10, 0x20, 0x30]),
		);
		expect(pixels.subarray(6, 9)).toEqual(Buffer.from([0x40, 0x50, 0x60]));
	});

	it("reads the pictures of the Completes engine from a name alone", async () => {
		const stream = new BitWriter().bit(1).byte(0x77);
		const file = xexFile("l", stream.toBuffer());
		expect(readXexGdLayout(file, "picture.GD")).toBeDefined();
		expect(readXexGdLayout(file, "picture.gd")).toBeDefined();
		// The engine's own reader insists on the extension.
		expect(readXexGdLayout(file, "picture.bin")).toBeUndefined();
		expect(readGdLayout(file)).toBeUndefined();
		expect(
			await c4XexGdImageFormat.detect(new BufferByteSource(file), "picture.GD"),
		).toBe(true);
		expect(
			await c4XexGdImageFormat.detect(
				new BufferByteSource(file),
				"picture.bin",
			),
		).toBe(false);
		// A stored picture is never taken by this engine.
		expect(
			readXexGdLayout(xexFile("b", Buffer.alloc(4)), "a.GD"),
		).toBeUndefined();
		const layout = readXexGdLayout(file, "picture.GD");
		if (!layout) throw new Error("the fixture is not a Completes picture");
		expect(layout.dataOffset).toBe(2);
		expect(unpackGdPicture(file, layout).subarray(0, 3)).toEqual(
			Buffer.from([0x77, 0x00, 0x00]),
		);
	});

	it("refuses a picture it cannot read", () => {
		const base = gdFile("b", Buffer.alloc(PICTURE, 0x00));
		expect(readGdLayout(base)).toBeDefined();
		expect(
			readGdLayout(gdFile("b", Buffer.alloc(PICTURE), "GD4")),
		).toBeUndefined();
		expect(readGdLayout(gdFile("x", Buffer.alloc(PICTURE)))).toBeUndefined();
		// The engine's word ends with a byte of its own.
		const wrongMark = gdFile("b", Buffer.alloc(PICTURE));
		wrongMark[3] = 0x1b;
		expect(readGdLayout(wrongMark)).toBeUndefined();
		const short = gdFile("b", Buffer.alloc(16, 0x00));
		const layout = readGdLayout(short);
		if (!layout)
			throw new Error("the short fixture still names its dimensions");
		expect(() => unpackGdPicture(short, layout)).toThrow();
	});
});
