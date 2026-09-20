import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	activeSoftEd8ImageFormat,
	readEd8Layout,
	unpackEd8Picture,
} from "../../packages/formats/src/active-soft/ed8-image.js";

const MARK = ".8Bit\x8d\x5d\x8c\xcb\x00";
const HEAD_SIZE = 0x1a;

/** The places of the walk of a picture stand in the places of the picture of every place of the walk of the
 * picture, the first place of the walk of a picture standing in the place behind the first place of the picture
 * of the walk of it. */
function pack(bits: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8));
	bits.forEach((bit, at) => {
		const place = Math.floor(at / 8);
		out[place] = ((out[place] ?? 0) | ((bit & 1) << (at % 8))) & 0xff;
	});
	return out;
}

/** The places of the walk of a picture of the count of them stand as the places of the walk of the picture of
 * the count of them, the first place standing above the places of the walk of the count. */
function placesOfWalk(value: number): number[] {
	return Array.from({ length: 8 }, (_, i) => (value >> (7 - i)) & 1);
}

/** `BitReader.CountBits`: the count of the places of the walk of a picture of the count of them. */
function countOfWalk(count: number): number[] {
	let bits = 0;
	let least = count;
	while (least > 1) {
		least >>= 1;
		bits += 1;
	}
	if (bits === 0) return [0];
	const out = [1, 1, 1, 1, 1, 1, 1, 1].slice(0, bits).concat([0]);
	for (let at = bits - 1; at >= 0; at -= 1) out.push((count >> at) & 1);
	return out;
}

function buildPicture(options: {
	width: number;
	height: number;
	colors: number;
	bits: readonly number[];
}): Buffer {
	const palette = Buffer.alloc(options.colors * 3);
	for (let at = 0; at < options.colors; at += 1) {
		palette[at * 3] = at * 3 + 1;
		palette[at * 3 + 1] = at * 3 + 2;
		palette[at * 3 + 2] = at * 3 + 3;
	}
	const walk = pack(options.bits);
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write(MARK, 0, "latin1");
	head.writeUInt16LE(options.width, 0xe);
	head.writeUInt16LE(options.height, 0x10);
	head.writeInt32LE(options.colors, 0x12);
	head.writeUInt32LE(walk.length, 0x16);
	return Buffer.concat([head, palette, walk]);
}

/** The places of the picture of the test: every place of the walk of the picture stands as a place of the
 * picture of its own, so the places of the picture stand as the places of the picture of the walk of them. */
const LITERALS = [0, 1, 2, 3, 3, 2, 1, 0];

function literalBits(pixels: readonly number[]): number[] {
	const bits: number[] = placesOfWalk(pixels[0] ?? 0);
	for (const pixel of pixels.slice(1)) {
		bits.push(1);
		bits.push(...placesOfWalk(pixel));
	}
	return bits;
}

describe("Active Soft indexed image format", () => {
	it("reads the head of a picture", () => {
		const file = buildPicture({
			width: 4,
			height: 2,
			colors: 4,
			bits: literalBits(LITERALS),
		});
		expect(readEd8Layout(file, file.length)).toEqual({
			width: 4,
			height: 2,
			paletteSize: 4,
			// The places of the walk of the picture of the test stand as the places of the picture of the
			// places of the walk of them, of which there stand one and seventy places of the walk.
			compSize: Math.ceil((8 + 7 * 9) / 8),
			dataOffset: HEAD_SIZE,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		const good = buildPicture({
			width: 4,
			height: 2,
			colors: 4,
			bits: literalBits(LITERALS),
		});
		const wrongMark = Buffer.from(good);
		wrongMark.write(".8Biu", 0, "latin1");
		expect(readEd8Layout(wrongMark, wrongMark.length)).toBeUndefined();
		// The places of the palette of a picture of this kind stand as the places of a picture of the places of
		// a picture of a kind of its own at the most.
		const many = Buffer.from(good);
		many.writeInt32LE(0x101, 0x12);
		expect(readEd8Layout(many, many.length)).toBeUndefined();
		const none = Buffer.from(good);
		none.writeInt32LE(0, 0x12);
		expect(readEd8Layout(none, none.length)).toBeUndefined();
		expect(readEd8Layout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("walks the places of the pictures of the test", () => {
		// Every place of the walk of the picture stands as a place of the picture of its own.
		const file = buildPicture({
			width: 4,
			height: 2,
			colors: 4,
			bits: literalBits(LITERALS),
		});
		const layout = readEd8Layout(file, file.length);
		if (!layout) throw new Error("no layout");
		const { pixels, palette } = unpackEd8Picture(file, layout);
		expect(pixels).toEqual(Buffer.from(LITERALS));
		// The places of the palette of a picture of this kind stand as the places of the picture of the words
		// of a picture of the engine, so the places of the picture stand behind the places of the picture.
		expect(palette).toEqual(
			Buffer.from([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0]),
		);
	});

	it("walks the places of a picture whose places of the walk stand beside them", () => {
		// A place of the walk of the picture stands for the places of the picture of the count of them, and the
		// places of the picture of the walk of the picture stand for the places of the picture of the count of
		// the walk of the picture of the two places of their own.
		const bits = placesOfWalk(5);
		bits.push(0);
		bits.push(0, 0);
		bits.push(...countOfWalk(2));
		bits.push(0, 0);
		const rest = [3, 4, 5, 6, 7];
		bits.push(...placesOfWalk(rest[0] ?? 0));
		for (const pixel of rest.slice(1)) {
			bits.push(1);
			bits.push(...placesOfWalk(pixel));
		}
		const file = buildPicture({ width: 4, height: 2, colors: 4, bits });
		const layout = readEd8Layout(file, file.length);
		if (!layout) throw new Error("no layout");
		const { pixels } = unpackEd8Picture(file, layout);
		expect(pixels).toEqual(Buffer.from([5, 5, 5, 3, 4, 5, 6, 7]));
	});

	it("stands the places of a picture out as a picture of a palette of its own", async () => {
		const file = buildPicture({
			width: 4,
			height: 2,
			colors: 4,
			bits: literalBits(LITERALS),
		});
		const handle = await activeSoftEd8ImageFormat.open(
			new BufferByteSource(file),
			"picture.ed8",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readInt32LE(0x12)).toBe(4);
		// The places of a picture of this kind stand from the first place of it rather than from the last.
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		expect(bmp.readUInt32LE(0x2e)).toBe(0x100);
		// A place of the palette of the picture stands as the places of the picture of the words of a picture
		// of the engine, which stand as the places of the picture of the background of the places behind them.
		expect(bmp.subarray(0x36, 0x46)).toEqual(
			Buffer.from([1, 2, 3, 0, 4, 5, 6, 0, 7, 8, 9, 0, 10, 11, 12, 0]),
		);
		const stride = 4;
		const places = Buffer.from(LITERALS);
		for (let row = 0; row < 2; row += 1) {
			expect(
				bmp.subarray(0x436 + row * stride, 0x436 + row * stride + 4),
			).toEqual(places.subarray(row * 4, (row + 1) * 4));
		}
	});

	it("turns a walk of the places of a picture that stands past the places of it away", () => {
		// A walk of the places of a picture that stands for the places of the picture of the count of them and
		// stands past the places of the picture of the walk of it stands away.
		const bits = placesOfWalk(1);
		bits.push(0);
		bits.push(0, 0);
		bits.push(...countOfWalk(4));
		bits.push(0, 0);
		const file = buildPicture({ width: 2, height: 1, colors: 1, bits });
		const layout = readEd8Layout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackEd8Picture(file, layout)).toThrow(GarbroError);
	});

	it("is told by the words of the picture", async () => {
		expect(activeSoftEd8ImageFormat.descriptor.id).toBe(
			"active-soft-ed8-image",
		);
		const file = buildPicture({
			width: 4,
			height: 2,
			colors: 4,
			bits: literalBits(LITERALS),
		});
		await expect(
			activeSoftEd8ImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrongMark = Buffer.from(file);
		wrongMark.write(".8Biu", 0, "latin1");
		await expect(
			activeSoftEd8ImageFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
	});
});
