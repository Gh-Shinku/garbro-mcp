import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	liddellBpaImageFormat,
	readBpaLayout,
} from "../../packages/formats/src/liddell/bpa-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const MARK = Buffer.from("-BPA-", "latin1");
const HEADER_SIZE = 0x11;
const COLOUR_BYTES = 3;
/** One control byte stands over four chunks, and a chunk over sixteen places at the most. */
const CHUNKS = 4;
const PLACES = 4;

function palette(colours: number): Buffer {
	const out = Buffer.alloc(colours * COLOUR_BYTES, 0x00);
	for (let index = 0; index < colours; index += 1) {
		out[index * 3 + 0] = index * 3 + 1;
		out[index * 3 + 1] = index * 3 + 2;
		out[index * 3 + 2] = index * 3 + 3;
	}
	return out;
}

/** Bits gathered into bytes the way the run's own reader takes them: from each byte's highest bit down. */
function bitStream(bits: number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (const [index, bit] of bits.entries()) {
		if (bit)
			out[index >> 3] = (out[index >> 3] ?? 0) | (1 << (7 - (index & 7)));
	}
	return out;
}

/**
 * A run of places that all stand as they are: a control byte of nothing in front of every **row**, and the
 * places behind it. A control byte stands over four chunks, and every chunk of a row takes as many places as
 * the row has left, so a row of four uses the first chunk of its own control byte.
 */
function storedRun(values: number[], rowWidth: number): Buffer {
	const out: number[] = [];
	for (let at = 0; at < values.length; at += rowWidth) {
		out.push(0x00, ...values.slice(at, Math.min(at + rowWidth, values.length)));
	}
	return Buffer.from(out);
}

function buildBpa(options: {
	width: number;
	height: number;
	colours: number;
	withPalette: boolean;
	depthBytes?: number;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	MARK.copy(head, 0);
	head.writeUInt16LE(options.width, 6);
	head.writeUInt16LE(options.height, 8);
	head.writeUInt16LE(options.colours, 0x0a);
	if (options.withPalette) {
		head.writeUInt16LE(HEADER_SIZE, 0x0c);
		head.writeUInt16LE(HEADER_SIZE + options.colours * COLOUR_BYTES, 0x0e);
		head[0x10] = 1;
		return Buffer.concat([head, palette(options.colours), options.body]);
	}
	head.writeUInt16LE(0, 0x0c);
	head.writeUInt16LE(HEADER_SIZE, 0x0e);
	head[0x10] = options.depthBytes ?? 1;
	return Buffer.concat([head, options.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await liddellBpaImageFormat.open(
		new BufferByteSource(data),
		"picture.bpa",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

function pixels(out: Buffer): Buffer {
	const image = readBmpImage(out);
	if (!image) throw new Error("the picture is not a bitmap");
	return image.pixels;
}

describe("Liddell image format", () => {
	it("reads the head of a picture, with and without a palette of its own", () => {
		const withPalette = buildBpa({
			width: 4,
			height: 1,
			colours: 4,
			withPalette: true,
			body: storedRun([1, 2, 3, 0], PLACES),
		});
		expect(readBpaLayout(withPalette)).toMatchObject({
			width: 4,
			height: 1,
			bitsPerPixel: 8,
			colours: 4,
			paletteOffset: HEADER_SIZE,
			alignedWidth: 4,
			channels: 1,
		});
		const withoutPalette = buildBpa({
			width: 4,
			height: 1,
			colours: 0,
			withPalette: false,
			depthBytes: 3,
			body: Buffer.alloc(12, 0x00),
		});
		expect(readBpaLayout(withoutPalette)).toMatchObject({
			bitsPerPixel: 24,
			paletteOffset: 0,
			channels: 3,
		});
	});

	it("takes a channel whose places all stand as they are", async () => {
		const out = await extract(
			buildBpa({
				width: 4,
				height: 1,
				colours: 4,
				withPalette: true,
				body: storedRun([1, 2, 3, 0], PLACES),
			}),
		);
		expect(pixels(out)).toEqual(Buffer.from([1, 2, 3, 0]));
	});

	it("fills as many places as a chunk's own count byte says", async () => {
		// A chunk marker of one, then the value and the number of places it fills.
		const out = await extract(
			buildBpa({
				width: 4,
				height: 1,
				colours: 4,
				withPalette: true,
				body: Buffer.from([0x40, 0x22, 0x04]),
			}),
		);
		expect(pixels(out)).toEqual(Buffer.from([0x22, 0x22, 0x22, 0x22]));
	});

	it("mixes one value with places that stand as they are", async () => {
		// A chunk marker of two, a control word read from its top - set places take the value, clear ones a
		// byte that stands as it is - and the value itself.
		// The word stands least significant byte first and is read from its top, so its first and third
		// places take the value and the other two stand as they are.
		const control = 0xa000;
		const out = await extract(
			buildBpa({
				width: 4,
				height: 1,
				colours: 4,
				withPalette: true,
				body: Buffer.concat([
					Buffer.from([0x80, control & 0xff, control >> 8, 0x33]),
					Buffer.from([0x91, 0x92]),
				]),
			}),
		);
		expect(pixels(out)).toEqual(Buffer.from([0x33, 0x91, 0x33, 0x92]));
	});

	it("takes places from the stack of values used last", async () => {
		// A chunk marker of three: every place is a value of its own, of eight bits, behind one bit the run
		// reads first and leaves aside. Four such places take thirty-six bits, so a byte stands behind them
		// which the run reads and leaves aside as well.
		const values = [0x11, 0x22, 0x33, 0x44];
		const bits: number[] = [];
		for (const value of values) {
			bits.push(0);
			for (let at = 7; at >= 0; at -= 1) bits.push((value >> at) & 1);
		}
		const out = await extract(
			buildBpa({
				width: 4,
				height: 1,
				colours: 4,
				withPalette: true,
				body: Buffer.concat([
					Buffer.from([0xc0]),
					bitStream(bits),
					Buffer.alloc(1),
				]),
			}),
		);
		expect(pixels(out)).toEqual(Buffer.from(values));
	});

	it("draws the channels of a picture together, from the bottom up", async () => {
		// Every channel of the fixture stands for one value throughout, so the picture must come out as that
		// value in every place, whatever order its rows are kept in.
		const blue = 0x11;
		const green = 0x22;
		const red = 0x33;
		const row = [blue, blue, blue, blue];
		const other = [green, green, green, green];
		const third = [red, red, red, red];
		const body = Buffer.concat([
			storedRun([...row, ...row], 4),
			Buffer.from([0x00]),
			storedRun([...other, ...other], 4),
			Buffer.from([0x00]),
			storedRun([...third, ...third], 4),
			Buffer.from([0x00]),
		]);
		const out = await extract(
			buildBpa({
				width: 4,
				height: 2,
				colours: 0,
				withPalette: false,
				depthBytes: 3,
				body,
			}),
		);
		const placed = pixels(out);
		expect(placed.length).toBe(4 * 2 * 3);
		for (let at = 0; at < placed.length; at += 3) {
			expect([placed[at], placed[at + 1], placed[at + 2]]).toEqual([
				blue,
				green,
				red,
			]);
		}
		expect(readBmpImage(out)).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 24,
		});
	});

	it("turns away a file that is not a picture of this engine", () => {
		const good = buildBpa({
			width: 4,
			height: 1,
			colours: 4,
			withPalette: true,
			body: storedRun([1, 2, 3, 0], PLACES),
		});
		const wrongWord = Buffer.from(good);
		wrongWord.write("XXXXX", 0, "latin1");
		expect(readBpaLayout(wrongWord)).toBeUndefined();
		const noDash = Buffer.from(good);
		noDash[4] = 0x20;
		expect(readBpaLayout(noDash)).toBeUndefined();
		const noSize = Buffer.from(good);
		noSize.writeUInt16LE(0, 6);
		expect(readBpaLayout(noSize)).toBeUndefined();
		expect(readBpaLayout(good.subarray(0, HEADER_SIZE - 1))).toBeUndefined();
	});

	it("is told by the word of the picture", async () => {
		expect(liddellBpaImageFormat.descriptor.id).toBe("liddell-bpa-image");
		const good = buildBpa({
			width: 4,
			height: 1,
			colours: 4,
			withPalette: true,
			body: storedRun([1, 2, 3, 0], PLACES),
		});
		expect(
			await liddellBpaImageFormat.detect(
				new BufferByteSource(good),
				"picture.bpa",
			),
		).toBe(true);
		await expect(
			liddellBpaImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"picture.bpa",
			),
		).rejects.toThrow(GarbroError);
	});
});
