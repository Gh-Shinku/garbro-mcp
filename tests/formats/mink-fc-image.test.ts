import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { fcImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	fcSignatures,
	readFcLayout,
} from "../../packages/formats/src/mink/fc-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

/** The bits of a picture, written the way the reader of this engine takes them. */
class FcWriter {
	private readonly bits: number[] = [];

	bit(value: number): void {
		this.bits.push(value & 1);
	}

	bitsOf(value: number, count: number): void {
		for (let at = count - 1; at >= 0; at -= 1) this.bit((value >>> at) & 1);
	}

	/** A run of the bits as the reader takes it: the first place standing clear ends the count. */
	varInt(value: number): void {
		const number = (value + 2) >>> 0;
		const count = 31 - Math.clz32(number);
		for (let at = 1; at < count; at += 1) this.bit(1);
		this.bit(0);
		this.bitsOf(number - 2 ** count, count);
	}

	/** The run of a colour of a place: the place standing lowest of it names the sign. */
	delta(value: number): void {
		this.varInt(((value << 1) ^ (value >> 31)) >>> 0);
	}

	/** The bits stand in words of four bytes, of which the highest of the first stands first. */
	words(): Buffer {
		const words: Buffer[] = [];
		for (let at = 0; at < this.bits.length; at += 32) {
			const word: Buffer = Buffer.alloc(4, 0x00);
			for (let place = 0; place < 32; place += 1) {
				const bit = this.bits[at + place] ?? 0;
				if (0 === bit) continue;
				const at2 = Math.trunc(place / 8);
				word[at2] = (word[at2] ?? 0) | (0x80 >> (place % 8));
			}
			words.push(word);
		}
		return Buffer.concat(words);
	}
}

/** A picture of this engine: its head, then the words behind it. */
function fcFile(
	width: number,
	height: number,
	bits: number,
	body: Buffer,
	options: { flag?: number; letter?: number } = {},
): Buffer {
	const head: Buffer = Buffer.alloc(8, 0x00);
	head.write("F", 0, "latin1");
	head[1] = options.letter ?? 0x43;
	head[2] = bits;
	head[3] = options.flag ?? 0;
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return Buffer.concat([head, body]);
}

async function pixelsOf(data: Buffer) {
	const handle = await fcImageFormat.open(new BufferByteSource(data), "cg.fc");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Mink compressed bitmap", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = fcFile(2, 2, 24, Buffer.alloc(4, 0x00));
		const layout = readFcLayout(good);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.flag).toBe(0);
		expect(readFcLayout(fcFile(2, 2, 32, Buffer.alloc(4)))).toBeDefined();
		// The second letter may stand of either case, and the head stands of eight kinds.
		expect(
			readFcLayout(fcFile(2, 2, 24, Buffer.alloc(4), { letter: 0x63 })),
		).toBeDefined();
		expect(fcSignatures().length).toBe(8);
		const wrongLetter = Buffer.from(good);
		wrongLetter[1] = 0x44;
		expect(readFcLayout(wrongLetter)).toBeUndefined();
		const wrongBits = Buffer.from(good);
		wrongBits[2] = 16;
		expect(readFcLayout(wrongBits)).toBeUndefined();
		const wrongFlag = Buffer.from(good);
		wrongFlag[3] = 2;
		expect(readFcLayout(wrongFlag)).toBeUndefined();
		expect(readFcLayout(good.subarray(0, 7))).toBeUndefined();
		expect(readFcLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
	});

	it("hands the places of its own kind over as the words of the picture name them", async () => {
		// The first place of a picture stands of the place of the greys it takes its runs from, and the place
		// behind it of the place before it, every colour taking a run of its own.
		const writer = new FcWriter();
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.delta(0x11);
		writer.delta(0x22);
		writer.delta(0x33);
		writer.bit(0);
		writer.bit(0);
		writer.delta(1);
		writer.delta(0);
		writer.delta(0);
		const image = await pixelsOf(fcFile(2, 1, 24, writer.words()));
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			0x11, 0x22, 0x33, 0x00, 0x12, 0x22, 0x33, 0x00,
		]);
	});

	it("takes a place of the picture from the place above it and from the ones beside that", async () => {
		// Three of the words of the picture name a place of the row above: the one above, the one above and
		// to the right of it, and the one above and to the left of it.
		const writer = new FcWriter();
		// The row above: a place of the greys, then a place taking a run of its own.
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.delta(0x0a);
		writer.delta(0x0b);
		writer.delta(0x0c);
		writer.bit(0);
		writer.bit(0);
		writer.delta(1);
		writer.delta(0);
		writer.delta(0);
		// The row below: the place above it, then the place above and to the right.
		writer.bit(1);
		writer.bit(1);
		writer.bit(1);
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.bit(1);
		writer.bit(1);
		writer.bit(0);
		const image = await pixelsOf(fcFile(2, 2, 24, writer.words()));
		// The places of a colour stand blue, green and red, and the rows of the picture stand from its top.
		// The rows of the picture stand from its bottom up, so the row the walk reached last shows on top.
		expect([...image.pixels]).toEqual([
			0x0a, 0x0b, 0x0c, 0x00, 0x0a, 0x0b, 0x0c, 0x00, 0x0a, 0x0b, 0x0c, 0x00,
			0x0b, 0x0b, 0x0c, 0x00,
		]);
	});

	it("hands the places standing as they are over, and the places the picture takes in runs", async () => {
		// A word of the picture names a place of three colours as it stands, and another hands the place it
		// has reached over as many times as the run of the bits behind it says.
		const writer = new FcWriter();
		writer.bit(1);
		writer.bit(1);
		writer.bit(0);
		writer.bit(0);
		writer.bitsOf(0x0c0b0a, 24);
		writer.bit(1);
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.varInt(3);
		const image = await pixelsOf(fcFile(2, 2, 24, writer.words()));
		expect([...image.pixels]).toEqual([
			0x0a, 0x0b, 0x0c, 0x00, 0x0a, 0x0b, 0x0c, 0x00, 0x0a, 0x0b, 0x0c, 0x00,
			0x0a, 0x0b, 0x0c, 0x00,
		]);
	});

	it("reads the alpha of a picture of four places to a pixel as runs of its own", async () => {
		const writer = new FcWriter();
		for (let place = 0; place < 4; place += 1) {
			writer.bit(1);
			writer.bit(0);
			writer.bit(1);
			writer.delta(0);
			writer.delta(0);
			writer.delta(0);
		}
		writer.bitsOf(0x80, 8);
		writer.varInt(1);
		writer.bitsOf(0x40, 8);
		writer.varInt(1);
		const image = await pixelsOf(fcFile(2, 2, 32, writer.words()));
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([
			0, 0, 0, 0x40, 0, 0, 0, 0x40, 0, 0, 0, 0x80, 0, 0, 0, 0x80,
		]);
	});

	it("hands a picture of the second kind over as the colours below the place above it", async () => {
		// The places of a picture of the second kind take their runs from a place of the greys, and the
		// colours of every place below the first row stand on the colours of the place above them.
		const writer = new FcWriter();
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.delta(0x10);
		writer.delta(0);
		writer.delta(0);
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.delta(0);
		writer.delta(0);
		writer.delta(0);
		const image = await pixelsOf(fcFile(1, 2, 24, writer.words(), { flag: 1 }));
		expect([...image.pixels]).toEqual([
			0x90, 0x80, 0x80, 0x00, 0x90, 0x80, 0x80, 0x00,
		]);
	});

	it("hands a picture whose words stand short over as the places it reached", async () => {
		// The places behind the words of a picture stand of nothing, so a picture whose words end stands of
		// places taken from the place before them.
		const image = await pixelsOf(fcFile(2, 1, 24, Buffer.alloc(0)));
		expect([...image.pixels]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("tells a picture by the head it opens with", async () => {
		const writer = new FcWriter();
		writer.bit(1);
		writer.bit(0);
		writer.bit(1);
		writer.delta(0);
		writer.delta(0);
		writer.delta(0);
		const data = fcFile(1, 1, 24, writer.words());
		expect(await fcImageFormat.detect?.(new BufferByteSource(data))).toBe(true);
		const wrong = Buffer.from(data);
		wrong[2] = 16;
		// The same picture, whose head names places of a place this engine does not know.
		expect(await fcImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
	});
});
