import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { tpgfImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readTpgfLayout } from "../../packages/formats/src/types/tpgf-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The bits of a picture, of the highest place of every place of the file first. */
class TpgfWriter {
	private readonly bits: number[] = [];

	bitsOf(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) {
			this.bits.push((value >>> at) & 1);
		}
	}

	/** The count of a run of the picture, of the places the reader stands of. */
	count(value: number): void {
		const places = value + 2;
		const index = 31 - Math.clz32(places);
		for (let at = 1; at < index; at += 1) this.bits.push(0);
		this.bits.push(1);
		this.bitsOf(places - 2 ** index, index);
	}

	/** A run of the picture standing of nothing, of as many places as the run stands of. */
	zeroes(places: number): void {
		this.bitsOf(0, 3);
		this.count(places - 1);
	}

	/** A run of the picture standing of the places of a colour, of as many places as the run stands of. */
	places(values: number[], placeBits: number): void {
		this.bitsOf(placeBits - 1, 3);
		this.count(values.length - 1);
		for (const value of values) this.bitsOf(value, placeBits);
	}

	/** The places of the picture, of the highest place of every place of the file first. */
	bytes(): Buffer {
		const bytes: number[] = [];
		for (let at = 0; at < this.bits.length; at += 8) {
			let value = 0;
			for (let place = 0; place < 8; place += 1) {
				value = (value << 1) | (this.bits[at + place] ?? 0);
			}
			bytes.push(value);
		}
		return Buffer.from(bytes);
	}
}

/** A picture of the Types engine: its head, of the places of it written from the higher one down. */
function tpgfFile(
	width: number,
	height: number,
	bits: number,
	body: Buffer,
): Buffer {
	const head: Buffer = Buffer.alloc(13, 0x00);
	head.write("TPGF", 4, "latin1");
	head.writeUInt16BE(width, 8);
	head.writeUInt16BE(height, 0xa);
	head[12] = bits;
	return Buffer.concat([head, body]);
}

/** The head of the places of an alpha standing behind the places of the colours of a picture. */
function alphaHead(width: number, height: number): Buffer {
	return Buffer.concat([
		Buffer.from([1]),
		tpgfFile(width, height, 8, Buffer.alloc(0)),
	]);
}

async function pictureOf(data: Buffer) {
	const handle = await tpgfImageFormat.open(
		new BufferByteSource(data),
		"cg.tpg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Types image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const writer = new TpgfWriter();
		writer.zeroes(4);
		const good = tpgfFile(4, 1, 8, writer.bytes());
		const layout = readTpgfLayout(good);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(8);
		expect(
			readTpgfLayout(tpgfFile(1, 1, 24, Buffer.alloc(8)))?.bitsPerPixel,
		).toBe(24);
		// A picture of another word, of another depth of places, and one standing short of its own head.
		const wrong = Buffer.from(good);
		wrong.write("TPGG", 4, "latin1");
		expect(readTpgfLayout(wrong)).toBeUndefined();
		expect(readTpgfLayout(tpgfFile(1, 1, 16, Buffer.alloc(8)))).toBeUndefined();
		expect(readTpgfLayout(tpgfFile(0, 1, 8, Buffer.alloc(8)))).toBeUndefined();
		expect(readTpgfLayout(good.subarray(0, 12))).toBeUndefined();
	});

	it("hands a picture of the greys of its own over, of the places of it", async () => {
		// A picture standing of a run of places of nothing, of the places of the picture behind it.
		const empty = new TpgfWriter();
		empty.zeroes(2);
		const image = await pictureOf(tpgfFile(2, 1, 8, empty.bytes()));
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([0x00, 0x00]);
		expect([...image.palette.subarray(0, 8)]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x01, 0x01, 0x01, 0x00,
		]);
		// A picture standing of the places of a colour, of their own places.
		const places = new TpgfWriter();
		places.places([0x2a], 8);
		const named = await pictureOf(tpgfFile(1, 1, 8, places.bytes()));
		expect([...named.pixels]).toEqual([0x2a]);
	});

	it("stands the places of a line of the picture of the place before them", async () => {
		// The places of a line stand of the places before them, of a table of its own the reader of the
		// reference stands of: 0x80 behind 0x40 stands of nothing, and 0x03 behind 0x02 stands of 0x04.
		const down = new TpgfWriter();
		down.places([0x40, 0x80], 8);
		const lower = await pictureOf(tpgfFile(2, 1, 8, down.bytes()));
		expect([...lower.pixels]).toEqual([0x40, 0x00]);
		const up = new TpgfWriter();
		up.places([0x02, 0x03], 8);
		const higher = await pictureOf(tpgfFile(2, 1, 8, up.bytes()));
		expect([...higher.pixels]).toEqual([0x02, 0x04]);
	});

	it("hands a picture of three colours over, of the places of every colour of it", async () => {
		// The places of a picture of three colours stand of three lines of the picture to a row, one place of
		// a colour of every one of them.
		const writer = new TpgfWriter();
		writer.places([0x11], 8);
		writer.places([0x22], 8);
		writer.places([0x33], 8);
		const image = await pictureOf(tpgfFile(1, 1, 24, writer.bytes()));
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([0x11, 0x22, 0x33, 0x00]);
	});

	it("reads the places of an alpha standing behind the colours of a picture", async () => {
		// A picture whose places stand of the places of an alpha behind them: the head of the alpha stands
		// behind the places of the colours, and the alpha stands of the places of the picture one off.
		const writer = new TpgfWriter();
		writer.places([0x11], 8);
		writer.places([0x22], 8);
		writer.places([0x33], 8);
		const alpha = new TpgfWriter();
		alpha.places([0x40], 8);
		const image = await pictureOf(
			tpgfFile(
				1,
				1,
				24,
				Buffer.concat([writer.bytes(), alphaHead(1, 1), alpha.bytes()]),
			),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([0x11, 0x22, 0x33, 0xbf]);
	});

	it("tells a picture by the word it opens with", async () => {
		const writer = new TpgfWriter();
		writer.zeroes(2);
		const data = tpgfFile(2, 1, 8, writer.bytes());
		expect(await tpgfImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		const wrong = Buffer.from(data);
		wrong[12] = 16;
		expect(await tpgfImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
		await expect(
			tpgfImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"cg.tpg",
			),
		).rejects.toThrow(GarbroError);
	});
});
