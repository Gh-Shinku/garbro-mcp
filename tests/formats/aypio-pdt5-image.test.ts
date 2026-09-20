import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	aypioPdt5ImageFormat,
	decodePdt5,
	readPdt5Layout,
	readPdt5Palette,
} from "../../packages/formats/src/aypio/pdt5-image.js";

/** A UK2 engine picture of the second kind: its head and the walk of its places. */
function pdt5File(input: {
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
	body: Buffer;
	colors?: number[];
	signature?: number;
}): Buffer {
	const head = Buffer.alloc(0x29, 0x00);
	head[0] = input.signature ?? 0x35;
	for (let entry = 0; entry < 16; entry += 1) {
		head.writeUInt16LE(input.colors?.[entry] ?? entry * 0x111, 1 + entry * 2);
	}
	head.writeUInt16LE(input.left ?? 0, 0x21);
	head.writeUInt16LE(input.top ?? 0, 0x23);
	head.writeUInt16LE(input.right ?? 0, 0x25);
	head.writeUInt16LE(input.bottom ?? 0, 0x27);
	return Buffer.concat([head, input.body]);
}

function bits(spec: string): Buffer {
	const out = Buffer.alloc(Math.ceil(spec.length / 8), 0x00);
	for (let at = 0; at < spec.length; at += 1) {
		if ("1" !== spec[at]) continue;
		const byte = at >> 3;
		out[byte] = (out[byte] ?? 0) | (1 << (at & 7));
	}
	return out;
}

describe("UK2 engine image format of the second kind", () => {
	it("reads the head of a picture", () => {
		const data = pdt5File({ right: 1, bottom: 3, body: Buffer.alloc(8, 0) });
		expect(readPdt5Layout(data)).toEqual({
			width: 16,
			height: 4,
			offsetX: 0,
			offsetY: 0,
		});
		const other = Buffer.from(data);
		other[0] = 0x34;
		expect(readPdt5Layout(other)).toBeUndefined();
		// A picture of more than six hundred and forty places of width is turned away.
		const wide = pdt5File({ right: 100, bottom: 0, body: Buffer.alloc(8, 0) });
		expect(readPdt5Layout(wide)).toBeUndefined();
	});

	it("reads the colours of a picture", () => {
		const data = pdt5File({
			colors: [0x0000, 0x00f0, 0x0f00, 0xf000],
			body: Buffer.from([0x00]),
		});
		const palette = readPdt5Palette(data);
		// The first colour is nought, the second one is red, the third one green and the fourth blue, and a
		// bitmap holds its colours blue first.
		expect(palette.subarray(0, 16).toString("hex")).toBe(
			hex([0, 0, 0, 0, 0, 0, 255, 0, 0, 255, 0, 0, 0, 0, 0, 0]),
		);
	});

	it("walks the places of a picture out of its table", () => {
		const data = pdt5File({
			right: 0,
			bottom: 0,
			body: bits(`0${"0100"}01${"1111".repeat(3)}`),
		});
		const layout = readPdt5Layout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodePdt5(data, layout);
		expect(bmp.readUInt32LE(0x12)).toBe(8);
		expect(bmp.readInt32LE(0x16)).toBe(-1);
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readUInt32LE(0x2e)).toBe(256);
		expect(bmp.subarray(0x436, 0x43e).toString("hex")).toBe(
			hex([1, 2, 2, 2, 2, 2, 2, 2]),
		);
	});

	it("walks the places of a picture that stand beside it", () => {
		const data = pdt5File({
			right: 0,
			bottom: 0,
			body: bits(`0${"0101"}${"1101"}${"10".repeat(5)}`),
		});
		const layout = readPdt5Layout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodePdt5(data, layout);
		expect(bmp.subarray(0x436, 0x43e).toString("hex")).toBe(
			hex([1, 1, 1, 1, 0, 0, 0, 0]),
		);
	});

	it("gathers a picture into a bitmap of eight bits", async () => {
		const data = pdt5File({
			right: 0,
			bottom: 0,
			colors: [0x0000, 0x00f0],
			body: bits(`0${"0100"}01${"1111".repeat(3)}`),
		});
		const handle = await aypioPdt5ImageFormat.open(
			new BufferByteSource(data),
			"picture.pdt",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry).toMatchObject({
			path: "picture.bmp",
			metadata: { type: "image", width: 8, height: 1, bitsPerPixel: 4 },
		});
		expect(handle.metadata).toEqual({ image: "bmp", bitsPerPixel: 4 });
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.subarray(0x436, 0x43e).toString("hex")).toBe(
			hex([1, 2, 2, 2, 2, 2, 2, 2]),
		);
	});

	it("reads a picture only by the names of the format", async () => {
		const data = pdt5File({ right: 0, bottom: 0, body: Buffer.alloc(4, 0) });
		expect(
			await aypioPdt5ImageFormat.detect(
				new BufferByteSource(data),
				"picture.anm",
			),
		).toBe(true);
		expect(
			await aypioPdt5ImageFormat.detect(
				new BufferByteSource(data),
				"picture.bmp",
			),
		).toBe(false);
	});

	it("stops where the walk of a picture runs out", () => {
		const data = pdt5File({
			right: 0,
			bottom: 0,
			body: Buffer.alloc(0, 0),
		});
		const layout = readPdt5Layout(data);
		if (!layout) throw new Error("no layout");
		expect(() => decodePdt5(data, layout)).toThrow(
			"UK2 picture is cut short of its walk",
		);
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
