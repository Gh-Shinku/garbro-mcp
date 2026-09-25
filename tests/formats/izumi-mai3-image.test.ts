import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { mai3ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	readMai3Layout,
	readMai3Palette,
} from "../../packages/formats/src/izumi/mai3-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

interface Mai3Parts {
	width: number;
	height: number;
	dataOffset: number;
	hasPalette?: boolean;
	/** The places of the picture behind the colour map of it. */
	body: Buffer;
	/** The places of the colour map, standing in front of the places of the picture. */
	palette?: Buffer;
}

/** A picture of the Izumi engine: its own head, the colour map of it and the places behind them. */
function mai3File(parts: Mai3Parts): Buffer {
	const head: Buffer = Buffer.alloc(14, 0x00);
	head.write("MAI03\x1a", 0, "latin1");
	head.writeUInt16LE(parts.width >> 3, 8);
	head.writeUInt16LE(parts.height, 0xa);
	head.writeUInt16LE(parts.dataOffset, 0xc);
	head[0xd] = parts.hasPalette ? 0x80 : 0x00;
	const body: Buffer[] = [head];
	while (
		body.reduce((size, part) => size + part.length, 0) < parts.dataOffset
	) {
		body.push(Buffer.alloc(1, 0x00));
	}
	if (parts.palette) body.push(parts.palette);
	body.push(parts.body);
	return Buffer.concat(body);
}

/** The places of a colour map of the picture: four places to a colour, red, green and blue. */
function paletteBytes(colours: number[][]): Buffer {
	const bits: number[] = [];
	for (const colour of colours) {
		for (let place = 3; place >= 0; place -= 1) {
			bits.push(((colour[0] ?? 0) >> place) & 1);
		}
		for (let place = 3; place >= 0; place -= 1) {
			bits.push(((colour[1] ?? 0) >> place) & 1);
		}
		for (let place = 3; place >= 0; place -= 1) {
			bits.push(((colour[2] ?? 0) >> place) & 1);
		}
	}
	const bytes: number[] = [];
	for (let at = 0; at < bits.length; at += 8) {
		let value = 0;
		for (let place = 0; place < 8; place += 1) {
			value = (value << 1) | (bits[at + place] ?? 0);
		}
		bytes.push(value);
	}
	return Buffer.from(bytes);
}

async function pictureOf(data: Buffer) {
	const handle = await mai3ImageFormat.open(
		new BufferByteSource(data),
		"cg.mi3",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Izumi engine image", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const good = mai3File({
			width: 16,
			height: 1,
			dataOffset: 14,
			body: Buffer.alloc(8),
		});
		const layout = readMai3Layout(good);
		expect(layout?.width).toBe(16);
		expect(layout?.height).toBe(1);
		expect(layout?.bitsPerPixel).toBe(4);
		expect(layout?.dataOffset).toBe(14);
		expect(layout?.hasPalette).toBe(false);
		// The word of another engine, a picture of no places at all, and one whose places stand past the end
		// of the file.
		const wrong = Buffer.from(good);
		wrong.write("MAI04", 0, "latin1");
		expect(readMai3Layout(wrong)).toBeUndefined();
		const empty = mai3File({
			width: 0,
			height: 1,
			dataOffset: 14,
			body: Buffer.alloc(8),
		});
		expect(readMai3Layout(empty)).toBeUndefined();
		const past = Buffer.from(good);
		past.writeUInt16LE(0x7fff, 0xc);
		expect(readMai3Layout(past)).toBeUndefined();
		expect(readMai3Layout(past)).toBeUndefined();
		expect(readMai3Layout(good.subarray(0, 13))).toBeUndefined();
	});

	it("reads the colour map of a picture, red, green and blue of four places to a colour", () => {
		const colours: number[][] = [];
		for (let at = 0; at < 16; at += 1) colours.push([at, 0x0f - at, at & 1]);
		const palette = readMai3Palette(paletteBytes(colours), 0);
		expect([...palette.subarray(0, 8)]).toEqual([
			(0 & 1) * 0x11,
			(0x0f - 0) * 0x11,
			0 * 0x11,
			0,
			(1 & 1) * 0x11,
			(0x0f - 1) * 0x11,
			1 * 0x11,
			0,
		]);
		const white = readMai3Palette(Buffer.alloc(24, 0xff), 0);
		expect([...white.subarray(0, 4)]).toEqual([0xff, 0xff, 0xff, 0x00]);
	});

	it("hands a picture of no places of its own over as the greys of its own", async () => {
		// A picture standing of no places at all, of the greys the engine stands of where its head names no
		// colour map of its own.
		const image = await pictureOf(
			mai3File({
				width: 16,
				height: 2,
				dataOffset: 14,
				body: Buffer.alloc(0x40, 0x00),
			}),
		);
		expect(image.bitsPerPixel).toBe(4);
		expect(image.width).toBe(16);
		expect(image.height).toBe(2);
		expect([...image.pixels]).toEqual(new Array(16).fill(0x00));
		expect([...image.palette.subarray(0, 12)]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x11, 0x11, 0x11, 0x00, 0x22, 0x22, 0x22, 0x00,
		]);
	});

	it("hands a picture of its own colour map over, of the places of it", async () => {
		const colours: number[][] = [];
		for (let at = 0; at < 16; at += 1) colours.push([at, at, at]);
		const image = await pictureOf(
			mai3File({
				width: 16,
				height: 1,
				dataOffset: 14 + 24,
				hasPalette: true,
				palette: paletteBytes(colours),
				body: Buffer.alloc(0x40, 0x00),
			}),
		);
		expect([...image.palette.subarray(0, 8)]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x11, 0x11, 0x11, 0x00,
		]);
		// A picture whose places stand short of a word of its own and one whose places stand of the places
		// behind them stand of the same places, which is where the port stands of the reference.
		expect([...image.pixels]).toEqual(new Array(8).fill(0x00));
	});

	it("reads a picture standing of groups of eight places to a group", async () => {
		// A picture of three groups of eight places: the first two stand of the places of a pair of groups,
		// and the last of them stands of the places of its own group alone.
		const image = await pictureOf(
			mai3File({
				width: 24,
				height: 2,
				dataOffset: 14,
				body: Buffer.alloc(0x40, 0x00),
			}),
		);
		expect(image.width).toBe(24);
		expect(image.height).toBe(2);
		expect([...image.pixels]).toEqual(new Array(24).fill(0x00));
	});

	it("tells a picture by the word it opens with", async () => {
		const data = mai3File({
			width: 16,
			height: 1,
			dataOffset: 14,
			body: Buffer.alloc(8, 0x00),
		});
		expect(await mai3ImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		const wrong = Buffer.from(data);
		wrong[5] = 0x00;
		expect(await mai3ImageFormat.detect?.(new BufferByteSource(wrong))).toBe(
			false,
		);
		await expect(
			mai3ImageFormat.open(
				new BufferByteSource(Buffer.alloc(64, 0x00)),
				"cg.mi3",
			),
		).rejects.toThrow(GarbroError);
	});
});
