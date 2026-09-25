import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ivorySgImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readSgLayout } from "../../packages/formats/src/ivory/sg-image.js";
import { decryptIvory } from "../../packages/formats/src/ivory/pk.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const BLOCK_SIZE = 0x24;
const HEAD_SIZE = 8;
const COLORS = 0x100;

/** A picture of the engine: the mark, the head of it and the places behind them. */
function sgFile(input: {
	kind: string;
	width: number;
	height: number;
	bitsPerPixel?: number;
	rgbMode?: number;
	offsetX?: number;
	offsetY?: number;
	jpegKey?: number;
	body: Buffer;
	dataSize?: number;
}): Buffer {
	const head: Buffer = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("fSG ", 0, "latin1");
	const block: Buffer = Buffer.alloc(BLOCK_SIZE, 0x00);
	block.write(input.kind, 0, "latin1");
	block.writeInt32LE(BLOCK_SIZE, 8);
	block.writeInt32LE(input.dataSize ?? input.body.length, 0xc);
	if ("cRGB" === input.kind) {
		block.writeUInt16LE(input.rgbMode ?? 0, 0x10);
		block.writeInt16LE(input.offsetX ?? 0, 0x18);
		block.writeInt16LE(input.offsetY ?? 0, 0x1a);
		block.writeUInt16LE(input.width, 0x1c);
		block.writeUInt16LE(input.height, 0x1e);
		block.writeUInt16LE(input.bitsPerPixel ?? 24, 0x22);
	} else {
		block.writeInt16LE(input.offsetX ?? 0, 0x14);
		block.writeInt16LE(input.offsetY ?? 0, 0x16);
		block.writeUInt16LE(input.width, 0x18);
		block.writeUInt16LE(input.height, 0x1a);
		block.writeUInt32LE(input.jpegKey ?? 0, 0x20);
	}
	return Buffer.concat([head, block, input.body]);
}

/** The colours of a picture of places standing of the colours behind them. */
function colorMap(): Buffer {
	const palette: Buffer = Buffer.alloc(COLORS * 4, 0x00);
	for (let at = 0; at < COLORS; at += 1) {
		palette[at * 4] = at;
		palette[at * 4 + 1] = at + 1;
		palette[at * 4 + 2] = at + 2;
	}
	return palette;
}

/** The walks of the bits of a row, of the lowest place of every place of the file first. */
class LsbWriter {
	private readonly bits: number[] = [];

	bitsOf(value: number, count: number): void {
		for (let at = 0; at < count; at += 1) this.bits.push((value >> at) & 1);
	}

	bytes(): Buffer {
		const out: number[] = [];
		for (let at = 0; at < this.bits.length; at += 8) {
			let value = 0;
			for (let bit = 0; bit < 8; bit += 1) {
				value |= (this.bits[at + bit] ?? 0) << bit;
			}
			out.push(value);
		}
		return Buffer.from(out);
	}
}

async function pictureOf(data: Buffer) {
	const handle = await ivorySgImageFormat.open(
		new BufferByteSource(data),
		"cg.sg",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Ivory image", () => {
	it("reads the head of a picture of the engine", () => {
		const layout = readSgLayout(
			sgFile({
				kind: "cRGB",
				width: 4,
				height: 2,
				bitsPerPixel: 32,
				rgbMode: 1,
				offsetX: 3,
				offsetY: 4,
				body: Buffer.alloc(4, 0x00),
			}),
		);
		expect(layout).toEqual({
			kind: "rgb",
			width: 4,
			height: 2,
			bitsPerPixel: 32,
			offsetX: 3,
			offsetY: 4,
			dataOffset: HEAD_SIZE + BLOCK_SIZE,
			dataSize: 4,
			rgbMode: 1,
			jpegKey: 0,
		});
		const jpeg = readSgLayout(
			sgFile({
				kind: "cJPG",
				width: 2,
				height: 1,
				jpegKey: 0x12345678,
				body: Buffer.alloc(4, 0x00),
			}),
		);
		expect(jpeg?.kind).toBe("jpeg");
		expect(jpeg?.jpegKey).toBe(0x12345678);
		expect(jpeg?.bitsPerPixel).toBe(24);
		const stray = Buffer.from(
			sgFile({ kind: "cXXX", width: 2, height: 1, body: Buffer.alloc(4) }),
		);
		expect(readSgLayout(stray)).toBeUndefined();
		expect(readSgLayout(Buffer.alloc(0x40, 0x00))).toBeUndefined();
	});

	it("reads a picture of places standing as they stand", async () => {
		const body = Buffer.from([
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
		]);
		const image = await pictureOf(
			sgFile({ kind: "cRGB", width: 2, height: 2, body }),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([...body]);
	});

	it("reads the places of a picture of the walks of every colour of it", async () => {
		// Every place of the picture stands of a walk of its own colour, of a count of two places.
		const body = Buffer.from([0x82, 0x10, 0x02, 0x20, 0x30, 0x82, 0x40]);
		const image = await pictureOf(
			sgFile({ kind: "cRGB", width: 2, height: 1, rgbMode: 1, body }),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([0x10, 0x20, 0x40, 0x10, 0x30, 0x40]);
	});

	it("reads a picture of places standing of the colours behind them", async () => {
		const rows: Buffer = Buffer.alloc(4, 0x00);
		rows.writeInt32LE(0, 0);
		const body = Buffer.concat([
			colorMap(),
			rows,
			// A run of two places of the colour at 5, then a place of the colour at 6 as it stands.
			Buffer.from([(2 << 2) | 1, 5, (1 << 2) | 0, 6]),
		]);
		const image = await pictureOf(
			sgFile({
				kind: "cRGB",
				width: 3,
				height: 1,
				bitsPerPixel: 24,
				rgbMode: 2,
				body,
			}),
		);
		expect(image.bitsPerPixel).toBe(8);
		expect([...image.pixels]).toEqual([5, 5, 6]);
	});

	it("reads a picture of places standing of the colours and the alpha behind them", async () => {
		const rows: Buffer = Buffer.alloc(4, 0x00);
		rows.writeInt32LE(0, 0);
		const walk = new LsbWriter();
		// A run of one place of the colour at 7, of an alpha of fifteen, and then a place of the colour
		// at 3 as it stands, of an alpha of one.
		walk.bitsOf(3, 2);
		walk.bitsOf(1, 10);
		walk.bitsOf(0xf, 4);
		walk.bitsOf(7, 8);
		walk.bitsOf(2, 2);
		walk.bitsOf(1, 10);
		walk.bitsOf(1, 4);
		walk.bitsOf(3, 8);
		const body = Buffer.concat([colorMap(), rows, walk.bytes()]);
		const image = await pictureOf(
			sgFile({
				kind: "cRGB",
				width: 2,
				height: 1,
				bitsPerPixel: 32,
				rgbMode: 2,
				body,
			}),
		);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([7, 8, 9, 0xff, 3, 4, 5, 0x1f]);
	});

	it("reads the places of a picture of the walks of every row of it", async () => {
		const rows: Buffer = Buffer.alloc(4, 0x00);
		rows.writeInt32LE(0, 0);
		// A walk of two places of one colour: the places of the second stand of the places of the first.
		// The count of the walk stands of the places behind the head of it, of two places.
		const body = Buffer.concat([
			rows,
			Buffer.from([0xc0, 0x02, 0x11, 0x22, 0x33]),
		]);
		const image = await pictureOf(
			sgFile({
				kind: "cRGB",
				width: 2,
				height: 1,
				bitsPerPixel: 24,
				rgbMode: 3,
				body,
			}),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([0x11, 0x22, 0x33, 0x11, 0x22, 0x33]);
	});

	it("hands the picture of a kind of its own over, of the places behind the key of it", async () => {
		const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 4, 5, 6, 7, 8]);
		const data = sgFile({
			kind: "cJPG",
			width: 2,
			height: 1,
			jpegKey: 0x12345678,
			body: jpeg,
		});
		const handle = await ivorySgImageFormat.open(
			new BufferByteSource(data),
			"cg.sg",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("image.jpg");
		const bytes = await consumeBuffer(await handle.openEntry(entry.id));
		expect([...bytes]).toEqual([...decryptIvory(jpeg, 0x12345678)]);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = sgFile({
			kind: "cRGB",
			width: 2,
			height: 1,
			body: Buffer.alloc(6, 0x11),
		});
		expect(await ivorySgImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await ivorySgImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
			),
		).toBe(false);
		await expect(
			ivorySgImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"cg.sg",
			),
		).rejects.toThrow(GarbroError);
	});
});
