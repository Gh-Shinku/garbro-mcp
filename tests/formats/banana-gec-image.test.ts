import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	bananaGecImageFormat,
	readGecLayout,
	unpackGecPicture,
} from "../../packages/formats/src/banana/gec-image.js";

const HEAD_SIZE = 0x11;
const ALPHA_HEAD_SIZE = 0x1d;

/** The places of the picture of the walk of the places of the picture: the places of the picture of the
 * walk of them stand of the places of the picture of a word of the walk of the places of the picture, the
 * places of the picture of the walk of the places of the picture standing of the places of the picture of
 * the walk of the places of the picture of the place of the picture of the walk of them behind the places of
 * the picture of the walk of the places of the picture of the place of the picture of the walk of them. */
function packBits(bits: number[]): Buffer {
	const words = Math.ceil(bits.length / 32);
	const out = Buffer.alloc(words * 4);
	for (let at = 0; at < bits.length; at += 1) {
		if ((bits[at] ?? 0) !== 0) {
			const byte = Math.floor(at / 32) * 4 + ((at % 32) >> 3);
			out[byte] = ((out[byte] ?? 0) | (1 << (at % 8))) & 0xff;
		}
	}
	return out;
}

/** The places of the picture of the words of the walk of the places of the picture of the walk of the places
 * of the picture of a picture of their own: the places of the picture of the walk of them stand of the
 * places of the picture of the walk of the places of the picture of the place of the picture of the walk of
 * them of the places of the picture of their own, and the places of the picture of the walk of the places of
 * the picture behind them of their own. */
function valueBits(value: number): number[] {
	let count = 0;
	while (1 << (count + 1) <= value) count += 1;
	const out: number[] = [];
	for (let i = 0; i < count; i += 1) out.push(0);
	out.push(1);
	for (let i = count - 1; i >= 0; i -= 1) out.push((value >> i) & 1);
	return out;
}

function head(options: {
	type: number;
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	alphaOffset?: number;
	dataOffset?: number;
	alphaWidth?: number;
	alphaHeight?: number;
	alphaDataOffset?: number;
	size?: number;
}): Buffer {
	const size =
		options.size ?? (options.type === 0 ? HEAD_SIZE : ALPHA_HEAD_SIZE);
	const out = Buffer.alloc(size, 0x00);
	out[0] = options.type;
	out.writeInt16LE(options.offsetX ?? 0, 1);
	out.writeInt16LE(options.offsetY ?? 0, 3);
	out.writeUInt16LE(options.width, 5);
	out.writeUInt16LE(options.height, 7);
	out.writeInt32LE(options.alphaOffset ?? 0, 9);
	out.writeInt32LE(options.dataOffset ?? 0, 0xd);
	if (options.type === 1 && size >= ALPHA_HEAD_SIZE) {
		out.writeUInt16LE(options.alphaWidth ?? 1, 0x15);
		out.writeUInt16LE(options.alphaHeight ?? 1, 0x17);
		out.writeInt32LE(options.alphaDataOffset ?? 0, 0x19);
	}
	return out;
}

describe("Yellow Pig image format", () => {
	it("reads the words of the head of a picture", () => {
		const file = Buffer.concat([
			head({
				type: 0,
				width: 4,
				height: 3,
				offsetX: 1,
				offsetY: 2,
				dataOffset: 8,
			}),
			Buffer.alloc(16),
		]);
		expect(readGecLayout(file, file.length)).toEqual({
			type: 0,
			offsetX: 1,
			offsetY: 2,
			width: 4,
			height: 3,
			bitsPerPixel: 24,
			alphaOffset: 0,
			dataOffset: 8,
			alphaWidth: 0,
			alphaHeight: 0,
			alphaDataOffset: 0,
		});
	});

	it("reads the words of the head of the picture of the places of the picture of their own", () => {
		const file = Buffer.concat([
			head({
				type: 1,
				width: 2,
				height: 2,
				alphaOffset: 8,
				dataOffset: 4,
				alphaWidth: 3,
				alphaHeight: 5,
				alphaDataOffset: 6,
			}),
			Buffer.alloc(16),
		]);
		const layout = readGecLayout(file, file.length);
		expect(layout?.bitsPerPixel).toBe(32);
		expect(layout?.alphaWidth).toBe(3);
		expect(layout?.alphaHeight).toBe(5);
		expect(layout?.alphaDataOffset).toBe(6);
	});

	it("turns away the words of the head of a picture of the kinds of the places of the picture of the engine", () => {
		const good = Buffer.concat([
			head({ type: 0, width: 2, height: 1 }),
			Buffer.alloc(16),
		]);
		const wrongType = Buffer.from(good);
		wrongType[0] = 2;
		expect(readGecLayout(wrongType, wrongType.length)).toBeUndefined();
		const noWidth = Buffer.from(good);
		noWidth.writeUInt16LE(0, 5);
		expect(readGecLayout(noWidth, noWidth.length)).toBeUndefined();
		const noHeight = Buffer.from(good);
		noHeight.writeUInt16LE(0, 7);
		expect(readGecLayout(noHeight, noHeight.length)).toBeUndefined();
		const negative = Buffer.from(good);
		negative.writeInt16LE(-1, 3);
		expect(readGecLayout(negative, negative.length)).toBeUndefined();
		const farOffset = Buffer.from(good);
		farOffset.writeInt32LE(0x1000, 0xd);
		expect(readGecLayout(farOffset, farOffset.length)).toBeUndefined();
		const noAlpha = Buffer.concat([
			head({ type: 1, width: 2, height: 1, alphaOffset: 0 }),
			Buffer.alloc(16),
		]);
		expect(readGecLayout(noAlpha, noAlpha.length)).toBeUndefined();
		const shortHead = head({ type: 1, width: 2, height: 1, size: 0x11 });
		expect(readGecLayout(shortHead, shortHead.length)).toBeUndefined();
		expect(readGecLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads the places of a picture of the walk of the places of the picture of the pictures of the engine", () => {
		// The places of the walk of the places of the picture of a picture of the run stand of the places of
		// the picture of no places of their own, so a picture of the places of the picture of the walk of the
		// places of the picture of a picture of their own stands of the places of the picture of no places of
		// the picture of the walk of them.
		// The places of the walk of the places of the picture: the places of the picture of the walk of the
		// places of the picture of the picture of their own, and the places of the picture of the walk of the
		// places of the picture of the runs of them.
		const bits = [1, 0, ...valueBits(8)];
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 1, dataOffset: 0 }),
			packBits(bits),
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const { places, bitsPerPixel } = unpackGecPicture(file, layout);
		expect(bitsPerPixel).toBe(24);
		expect(places).toEqual(Buffer.alloc(6));
	});

	it("reads the places of the picture of the walk of the places of the picture of a picture of its own", () => {
		// The places of the picture of the walk of the places of the picture stand of the places of the
		// picture of the walk of the places of the picture of the place of the picture of the walk of them,
		// the places of the picture of the walk of the places of the picture of a picture of their own
		// standing before the places of the picture of the walk of the places of the picture of the picture
		// of the places of the picture of the walk of them.
		const codes = [1, 1, 1, 1, 1, 1, 1, 1];
		const bits = [1];
		for (const code of codes) bits.push(1, ...valueBits(code));
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 1, dataOffset: 0 }),
			packBits(bits),
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackGecPicture(file, layout).places).toEqual(
			Buffer.from([0, 1, 0, 0, 1, 0]),
		);
	});

	it("reads the places of the picture of the walk of the places of the picture of a picture of the picture of the walk of them", () => {
		const codes = [2, 2, 2, 2, 2, 2, 2, 2];
		const bits = [1];
		for (const code of codes) bits.push(1, ...valueBits(code));
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 1, dataOffset: 0 }),
			packBits(bits),
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackGecPicture(file, layout).places).toEqual(
			Buffer.from([2, 1, 1, 2, 1, 1]),
		);
	});

	it("reads the places of a picture of the walk of the places of the picture of a picture of the walk of the places of them", () => {
		// The places of the picture of the walk of the places of the picture stand of the places of the
		// picture of the walk of the places of the picture of the picture of their own, and of the places of
		// the picture of the walk of the places of the picture of the words of the walk of the picture of the
		// places of the picture of the walk of them.
		const bits = [0, 0, 0];
		const body = Buffer.concat([
			packBits(bits),
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		]);
		const file = Buffer.concat([
			head({ type: 0, width: 1, height: 2, dataOffset: 4 }),
			body,
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackGecPicture(file, layout).places).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		);
	});

	it("reads the places of the picture of the walk of the places of the picture of the runs of them", () => {
		// The places of the picture of the walk of the places of the picture of the picture of their own
		// stand of the places of the picture of the walk of the places of the picture of the walk of them, so
		// a place of the picture stands of the places of the picture of the walk of them of the places of the
		// picture of the picture.
		// The places of the walk of the places of the picture: the places of the picture of the walk of the
		// places of the picture of the pictures of the engine, the places of the picture of the walk of the
		// places of the picture of a picture of the walk of them, and the places of the picture of the walk
		// of the places of the picture of the runs of them.
		const bits = [0, 0, 1, ...valueBits(3)];
		const body = Buffer.concat([
			packBits(bits),
			Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60]),
		]);
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 2, dataOffset: 4 }),
			body,
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackGecPicture(file, layout).places).toEqual(
			Buffer.from([
				0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x40, 0x50, 0x60, 0x40, 0x50, 0x60,
			]),
		);
	});

	it("stands the places of the picture of the walk of the places of the picture of the picture of the places of the picture beside the places of the picture of the walk of them", () => {
		// The places of the picture of the walk of the places of the picture of the picture of the walk of
		// them stand beside the places of the picture of the walk of the places of the picture of the
		// picture of their own.
		const bits = [0, 0];
		const body = Buffer.concat([
			packBits(bits),
			Buffer.from([0x07, 0x08, 0x09]),
			Buffer.alloc(1),
			packBits([1, ...valueBits(1)]),
			Buffer.from([0xab]),
		]);
		const file = Buffer.concat([
			head({
				type: 1,
				width: 1,
				height: 1,
				dataOffset: 4,
				alphaOffset: 8,
				alphaWidth: 1,
				alphaHeight: 1,
				alphaDataOffset: 4,
			}),
			body,
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const { places, bitsPerPixel } = unpackGecPicture(file, layout);
		expect(bitsPerPixel).toBe(32);
		expect(places).toEqual(Buffer.from([0x07, 0x08, 0x09, 0xab]));
	});

	it("stands the places of a picture out as the places of the picture of the walk of them", async () => {
		const codes = [1, 1, 1, 1, 1, 1, 1, 1];
		const bits = [1];
		for (const code of codes) bits.push(1, ...valueBits(code));
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 1, dataOffset: 0 }),
			packBits(bits),
		]);
		const handle = await bananaGecImageFormat.open(
			new BufferByteSource(file),
			"cg/pic.gec",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("pic.bmp");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		// The reference stands the places of the picture of the walk of the places of the picture of the
		// picture of the places of the picture of the walk of them of the picture of the places of the
		// picture of the picture of its own, so the places of the picture of the walk of them stand of the
		// places of the picture of the walk of the places of the picture of the picture.
		expect(bmp.readInt32LE(0x16)).toBe(1);
		expect(bmp.subarray(0x36, 0x3c)).toEqual(Buffer.from([0, 1, 0, 0, 1, 0]));
	});

	it("is told by the words of the head of the picture", async () => {
		expect(bananaGecImageFormat.descriptor.id).toBe("banana-gec-image");
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 1 }),
			Buffer.alloc(16),
		]);
		await expect(
			bananaGecImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrongType = Buffer.from(file);
		wrongType[0] = 3;
		await expect(
			bananaGecImageFormat.detect(new BufferByteSource(wrongType)),
		).resolves.toBe(false);
	});

	it("turns a picture of the walk of the places of the picture of no places of the picture of the walk of them away", async () => {
		// The places of the picture of the walk of the places of the picture of the picture of the walk of
		// them stand short of the places of the picture of the walk of the places of the picture of the
		// picture of their own where the places of the picture of the walk of them stand as the places of the
		// picture of the words of the walk of the picture.
		const bits = [0, 0, 0];
		const file = Buffer.concat([
			head({ type: 0, width: 2, height: 2, dataOffset: 4 }),
			packBits(bits),
		]);
		const layout = readGecLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackGecPicture(file, layout)).toThrow(GarbroError);
		await expect(
			bananaGecImageFormat.open(new BufferByteSource(Buffer.alloc(4)), "x.gec"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
