import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeLfg,
	leafLfgImageFormat,
	readLfgLayout,
	readLfgPalette,
	unpackLfg,
} from "../../packages/formats/src/leaf/lfg-image.js";

/** A Leaf picture: the head of forty eight bytes, the colours behind it and the walk at the end of the head. */
function lfgFile(input: {
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
	mode?: number;
	keyColor?: number;
	imageSize: number;
	colors?: number[];
	body: Buffer;
	word?: string;
}): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	head.write(input.word ?? "LEAFCODE", 0, "latin1");
	for (let at = 0; at < 24; at += 1) {
		head[0x08 + at] = input.colors?.[at] ?? 0x00;
	}
	head.writeInt16LE(input.left ?? 0, 0x20);
	head.writeInt16LE(input.top ?? 0, 0x22);
	head.writeInt16LE(input.right ?? 0, 0x24);
	head.writeInt16LE(input.bottom ?? 1, 0x26);
	head[0x28] = input.mode ?? 1;
	head[0x29] = input.keyColor ?? 0;
	head.writeInt32LE(input.imageSize, 0x2c);
	return Buffer.concat([head, input.body]);
}

describe("Leaf image format", () => {
	it("reads the head of a picture", () => {
		// Eight places of width stand in every place between the edges, and two places of height in every
		// place between the top and the bottom.
		const data = lfgFile({
			right: 3,
			bottom: 3,
			imageSize: 32,
			body: Buffer.alloc(32, 0),
		});
		expect(readLfgLayout(data)).toEqual({
			width: 32,
			height: 4,
			stride: 16,
			imageSize: 32,
			mode: 1,
			keyColor: 0,
		});
		const other = Buffer.from(data);
		other.write("LEAFCODZ", 0, "latin1");
		expect(readLfgLayout(other)).toBeUndefined();
		const empty = lfgFile({ right: -1, imageSize: 1, body: Buffer.from([0]) });
		expect(readLfgLayout(empty)).toBeUndefined();
		expect(readLfgLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
	});

	it("reads the colours of a picture", () => {
		// Every byte behind the word of the file stands for two parts of a colour, its higher four places
		// first, and the parts of a colour stand red, green and blue.
		const data = lfgFile({
			imageSize: 1,
			colors: [0x12, 0x34, 0x56, 0x78],
			body: Buffer.from([0]),
		});
		const palette = readLfgPalette(data);
		expect(Array.from(palette.subarray(0, 6))).toEqual([
			0x11, 0x22, 0x33, 0x44, 0x55, 0x66,
		]);
	});

	it("walks the pairs of places of a picture along its rows", () => {
		// Every place of the byte at hand stands, so the walk takes a byte at a time: the table of the
		// picture stands every byte for a pair of places, and the places stand along the rows.
		const data = lfgFile({
			imageSize: 8,
			body: Buffer.concat([
				Buffer.from([0xff]),
				Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
			]),
		});
		const layout = readLfgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackLfg(data, layout).toString("hex")).toBe(
			hex([0x00, 0x01, 0x10, 0x11, 0x02, 0x03, 0x12, 0x13]),
		);
	});

	it("walks the pairs of places of a picture down its columns", () => {
		const data = lfgFile({
			mode: 2,
			imageSize: 8,
			body: Buffer.concat([
				Buffer.from([0xff]),
				Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
			]),
		});
		const layout = readLfgLayout(data);
		if (!layout) throw new Error("no layout");
		// Four bytes stand in a row of the picture and two rows stand there: the first two pairs stand at the
		// beginning of the rows and the two behind them at the end of them.
		expect(unpackLfg(data, layout).toString("hex")).toBe(
			hex([0x00, 0x10, 0x02, 0x12, 0x01, 0x11, 0x03, 0x13]),
		);
	});

	it("walks a run of pairs that stand before the place at hand", () => {
		// Three pairs stand for themselves and a fourth step names three pairs that stand three pairs behind
		// them, so the first three pairs stand again.
		const data = lfgFile({
			imageSize: 6,
			body: Buffer.concat([
				Buffer.from([0xe0]),
				Buffer.from([0x00, 0x02, 0x04]),
				Buffer.from([0xe0, 0xfe]),
			]),
		});
		const layout = readLfgLayout(data);
		if (!layout) throw new Error("no layout");
		expect(unpackLfg(data, layout).toString("hex")).toBe(
			hex([0x00, 0x10, 0x02, 0x00, 0x10, 0x02, 0x00, 0x00]),
		);
	});

	it("gathers a picture into a bitmap of four bits", async () => {
		const data = lfgFile({
			right: 0,
			bottom: 1,
			keyColor: 3,
			imageSize: 8,
			colors: [0x12, 0x34, 0x56, 0x78],
			body: Buffer.concat([
				Buffer.from([0xff]),
				Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07]),
			]),
		});
		const handle = await leafLfgImageFormat.open(
			new BufferByteSource(data),
			"picture.lfg",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry).toMatchObject({
			path: "picture.bmp",
			metadata: {
				type: "image",
				width: 8,
				height: 2,
				bitsPerPixel: 4,
				keyColor: 3,
			},
		});
		const out = await consumeBuffer(await handle.openEntry(entry.id));
		expect(out.readUInt32LE(0x12)).toBe(8);
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.readUInt16LE(0x1c)).toBe(4);
		expect(out.readUInt32LE(0x2e)).toBe(16);
		// The colours of the head stand in the bitmap in the order a bitmap holds them, blue first.
		// The parts of the colours stand red, green and blue, so the second colour of the head is
		// 0x44, 0x55, 0x66 and the third one is 0x77, 0x88 and nought.
		expect(out.subarray(0x36, 0x42).toString("hex")).toBe(
			hex([
				0x33, 0x22, 0x11, 0x00, 0x66, 0x55, 0x44, 0x00, 0x00, 0x88, 0x77, 0x00,
			]),
		);
		expect(out.subarray(0x76, 0x7e).toString("hex")).toBe(
			hex([0x00, 0x01, 0x10, 0x11, 0x02, 0x03, 0x12, 0x13]),
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const other = lfgFile({ imageSize: 8, body: Buffer.alloc(8, 0) });
		other.write("LEAFCODZ", 0, "latin1");
		await expect(
			leafLfgImageFormat.open(new BufferByteSource(other), "picture.lfg"),
		).rejects.toThrow(GarbroError);
		await expect(
			leafLfgImageFormat.open(new BufferByteSource(other), "picture.lfg"),
		).rejects.toThrow("Not a Leaf picture");
	});

	it("stops where the walk of a picture runs out", () => {
		const short = lfgFile({
			imageSize: 8,
			body: Buffer.concat([Buffer.from([0xff]), Buffer.from([0x00])]),
		});
		const layout = readLfgLayout(short);
		if (!layout) throw new Error("no layout");
		expect(() => decodeLfg(short, layout)).toThrow(
			"Leaf picture is cut short of its walk",
		);
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
