import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { gameresTgaImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readBmpImage,
	RGB555_MASKS,
} from "../../packages/formats/src/shared/bmp.js";
import { readTgaLayout } from "../../packages/formats/src/gameres/tga-image.js";

interface TgaParts {
	width: number;
	height: number;
	imageType: number;
	bitsPerPixel: number;
	colormapType?: number;
	colormapDepth?: number;
	colormapLength?: number;
	idLength?: number;
	descriptor?: number;
	palette?: Buffer;
	data: Buffer;
}

/** A picture of this engine: its head of eighteen bytes, then whatever stands behind it. */
function tgaFile(parts: TgaParts): Buffer {
	const head: Buffer = Buffer.alloc(18, 0x00);
	head[0] = parts.idLength ?? 0;
	head[1] = parts.colormapType ?? 0;
	head[2] = parts.imageType;
	head.writeUInt16LE(0, 3);
	head.writeUInt16LE(parts.colormapLength ?? 0, 5);
	head[7] = parts.colormapDepth ?? 0;
	head.writeInt16LE(7, 8);
	head.writeInt16LE(9, 10);
	head.writeUInt16LE(parts.width, 0xc);
	head.writeUInt16LE(parts.height, 0xe);
	head[0x10] = parts.bitsPerPixel;
	head[0x11] = parts.descriptor ?? 0;
	const body: Buffer[] = [head];
	if ((parts.idLength ?? 0) > 0)
		body.push(Buffer.alloc(parts.idLength ?? 0, 0xcc));
	if (parts.palette) body.push(parts.palette);
	body.push(parts.data);
	return Buffer.concat(body);
}

async function extract(data: Buffer, name = "cg.tga"): Promise<Buffer> {
	const handle = await gameresTgaImageFormat.open(
		new BufferByteSource(data),
		name,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/** The picture a bitmap holds, as a list of the places of it. */
async function placesOf(data: Buffer) {
	const image = readBmpImage(await extract(data));
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Truevision Targa image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = tgaFile({
			width: 2,
			height: 2,
			imageType: 2,
			bitsPerPixel: 24,
			data: Buffer.alloc(12, 0x00),
		});
		const layout = readTgaLayout(good);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(2);
		expect(layout?.bitsPerPixel).toBe(24);
		expect(layout?.offsetX).toBe(7);
		expect(layout?.offsetY).toBe(9);
		// A colour map of a kind the reference does not know, a depth it does not know, a way of the picture
		// it does not know, a colour map of a depth a colour mapped picture may not stand of, and a head that
		// stands short of its own end.
		const wrongKind = Buffer.from(good);
		wrongKind[1] = 2;
		expect(readTgaLayout(wrongKind)).toBeUndefined();
		const wrongDepth = Buffer.from(good);
		wrongDepth[0x10] = 12;
		expect(readTgaLayout(wrongDepth)).toBeUndefined();
		const wrongType = Buffer.from(good);
		wrongType[2] = 4;
		expect(readTgaLayout(wrongType)).toBeUndefined();
		const mapped = tgaFile({
			width: 2,
			height: 2,
			imageType: 1,
			bitsPerPixel: 8,
			colormapType: 1,
			colormapDepth: 8,
			colormapLength: 2,
			palette: Buffer.alloc(2, 0x00),
			data: Buffer.alloc(4, 0x00),
		});
		expect(readTgaLayout(mapped)).toBeUndefined();
		expect(readTgaLayout(good.subarray(0, 17))).toBeUndefined();
		expect(readTgaLayout(new Buffer(0))).toBeUndefined();
	});

	it("hands a picture whose rows stand the other way up over the right way up", async () => {
		// The places of a picture of three colours stand blue, green and red to a place, and the rows of a
		// picture that names no other way stand from the bottom of it up.
		const data: Buffer = Buffer.from([
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
		]);
		const image = await placesOf(
			tgaFile({ width: 2, height: 2, imageType: 2, bitsPerPixel: 24, data }),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([
			70, 80, 90, 100, 110, 120, 10, 20, 30, 40, 50, 60,
		]);
	});

	it("hands a picture whose rows stand the right way up already over as it stands", async () => {
		const data: Buffer = Buffer.from([
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
		]);
		const image = await placesOf(
			tgaFile({
				width: 2,
				height: 2,
				imageType: 2,
				bitsPerPixel: 24,
				descriptor: 0x20,
				data,
			}),
		);
		expect([...image.pixels]).toEqual([
			10, 20, 30, 40, 50, 60, 70, 80, 90, 100, 110, 120,
		]);
	});

	it("hands the places of a picture over as the runs of its bits name them", async () => {
		// Two places as they stand, then two of the place behind them; the first of the two packets carries its
		// own places in the bits, the second names the place it hands over as many times as its bits say.
		const data: Buffer = Buffer.from([0x01, 1, 2, 3, 4, 5, 6, 0x81, 7, 8, 9]);
		const image = await placesOf(
			tgaFile({
				width: 4,
				height: 1,
				imageType: 10,
				bitsPerPixel: 24,
				descriptor: 0x20,
				data,
			}),
		);
		expect([...image.pixels]).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 7, 8, 9]);
	});

	it("reads the colour map of a picture of eight bits", async () => {
		// The name of the picture stands in front of its colour map, and the places of the picture stand
		// behind the map; the map names a colour of its own for every place it holds.
		const data: Buffer = Buffer.from([1, 1, 0, 0]);
		const file = tgaFile({
			width: 2,
			height: 2,
			imageType: 1,
			bitsPerPixel: 8,
			colormapType: 1,
			colormapDepth: 24,
			colormapLength: 2,
			idLength: 4,
			palette: Buffer.from([1, 2, 3, 4, 5, 6]),
			data,
		});
		const image = await placesOf(file);
		expect(image.bitsPerPixel).toBe(8);
		// The rows of the picture stand from the bottom of it up, and the colour map stands blue first.
		expect([...image.pixels]).toEqual([0, 0, 1, 1]);
		expect([...image.palette.subarray(0, 8)]).toEqual([1, 2, 3, 0, 4, 5, 6, 0]);
		// The colour map of a picture names at most as many colours as a picture of eight bits holds places.
		const tooMany = tgaFile({
			width: 2,
			height: 2,
			imageType: 1,
			bitsPerPixel: 8,
			colormapType: 1,
			colormapDepth: 24,
			colormapLength: 0x101,
			palette: Buffer.alloc(0x101 * 3, 0x00),
			data,
		});
		await expect(extract(tooMany)).rejects.toThrow(GarbroError);
	});

	it("hands a picture of nothing but greys over as the greys of its engine", async () => {
		const image = await placesOf(
			tgaFile({
				width: 2,
				height: 1,
				imageType: 3,
				bitsPerPixel: 8,
				descriptor: 0x20,
				data: Buffer.from([0x00, 0xff]),
			}),
		);
		expect([...image.pixels]).toEqual([0x00, 0xff]);
		expect([...image.palette.subarray(0, 12)]).toEqual([
			0, 0, 0, 0, 1, 1, 1, 0, 2, 2, 2, 0,
		]);
	});

	it("hands a picture of sixteen bits over as the places of five bits to a colour", async () => {
		const data: Buffer = Buffer.from([0x00, 0x7c, 0xe0, 0x03]);
		const image = await placesOf(
			tgaFile({
				width: 2,
				height: 1,
				imageType: 2,
				bitsPerPixel: 16,
				descriptor: 0x20,
				data,
			}),
		);
		expect(image.bitsPerPixel).toBe(16);
		expect([...image.pixels]).toEqual([0x00, 0x7c, 0xe0, 0x03]);
		expect(image.masks).toEqual(RGB555_MASKS);
	});

	it("keeps a place of its own for the picture whose descriptor names eight alpha bits", async () => {
		// A picture of twenty four bits whose descriptor names eight alpha bits stands of four bytes to a
		// place as the reference reads it, the last of them the place of the alpha.
		const data: Buffer = Buffer.from([1, 2, 3, 0x80, 4, 5, 6, 0x40]);
		const file = tgaFile({
			width: 2,
			height: 1,
			imageType: 2,
			bitsPerPixel: 24,
			descriptor: 0x28,
			data,
		});
		const layout = readTgaLayout(file);
		expect(layout?.descriptor).toBe(0x28);
		const image = await placesOf(file);
		expect(image.bitsPerPixel).toBe(32);
		expect([...image.pixels]).toEqual([...data]);
	});

	it("refuses the pictures that stand of Huffman, delta and runlength coding", async () => {
		const file = tgaFile({
			width: 2,
			height: 1,
			imageType: 9,
			bitsPerPixel: 8,
			colormapType: 1,
			colormapDepth: 24,
			colormapLength: 2,
			palette: Buffer.alloc(6, 0x00),
			data: Buffer.from([0x00, 0x01]),
		});
		// The reference takes such a picture and then refuses to draw it.
		expect(
			await gameresTgaImageFormat.detect?.(new BufferByteSource(file)),
		).toBe(true);
		const handle = await gameresTgaImageFormat.open(
			new BufferByteSource(file),
			"cg.tga",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		await expect(handle.openEntry(entry.id)).rejects.toThrow(/Huffman/);
	});
});
