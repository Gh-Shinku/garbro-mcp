import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	bishopBsgImageFormat,
	decodeBsgPixels,
	readBsgLayout,
	unpackBsgPicture,
} from "../../packages/formats/src/bishop/bsg-image.js";
import type { BsgLayout } from "../../packages/formats/src/bishop/bsg-image.js";

const COMPOSITION_SIZE = 0x20;
const DATA_AT = 0x100;
const MODE_BGRA = 0;
const MODE_BGR = 1;
const MODE_INDEXED = 2;
const STORED = 0;
const RUN_CODED = 1;
const BACK_REFERENCED = 2;

/** A `BSS-Graphics` header, optionally behind the composition one, with its channels after it. */
function buildBsg(options: {
	composition?: boolean;
	colorMode: number;
	compressionMode: number;
	width: number;
	height: number;
	data: Buffer;
	dataSize?: number;
	palette?: Buffer;
	unpackedSize?: number;
}): Buffer {
	const base = options.composition ? COMPOSITION_SIZE : 0;
	const paletteAt = DATA_AT + options.data.length;
	const file = Buffer.alloc(paletteAt + (options.palette?.length ?? 0), 0x00);
	if (options.composition) file.write("BSS-Composition\0", 0, "latin1");
	file.write("BSS-Graphics\0", base, "latin1");
	file.writeInt32LE(
		options.unpackedSize ??
			options.width *
				options.height *
				(MODE_INDEXED === options.colorMode ? 1 : 4),
		base + 0x12,
	);
	file.writeUInt16LE(options.width, base + 0x16);
	file.writeUInt16LE(options.height, base + 0x18);
	file.writeInt16LE(-3, base + 0x20);
	file.writeInt16LE(7, base + 0x22);
	file[base + 0x30] = options.colorMode;
	file[base + 0x31] = options.compressionMode;
	file.writeInt32LE(DATA_AT - base, base + 0x32);
	file.writeInt32LE(options.dataSize ?? options.data.length, base + 0x36);
	file.writeInt32LE(paletteAt - base, base + 0x3a);
	options.data.copy(file, DATA_AT);
	if (options.palette) options.palette.copy(file, paletteAt);
	return file;
}

/** One channel of the run coder: its length word and its counts. */
function runsChannel(bytes: number[]): Buffer {
	const out = Buffer.alloc(4 + bytes.length, 0x00);
	out.writeInt32LE(bytes.length, 0);
	Buffer.from(bytes).copy(out, 4);
	return out;
}

/** One channel of the back referencing walk: a control byte, its length word, then its bytes. */
function walkChannel(control: number, bytes: number[]): Buffer {
	const out = Buffer.alloc(5 + bytes.length, 0x00);
	out[0] = control;
	out.writeInt32LE(5 + bytes.length, 1);
	Buffer.from(bytes).copy(out, 5);
	return out;
}

function layoutOf(file: Buffer): BsgLayout {
	const layout = readBsgLayout(file);
	if (!layout) throw new Error("no layout");
	return layout;
}

/** The pixel data of a bitmap, at the offset its own header gives. */
function bitmapPixels(bmp: Buffer): Buffer {
	return bmp.subarray(bmp.readUInt32LE(0x0a));
}

describe("Bishop image format", () => {
	it("reads the header with and without a composition in front of it", () => {
		const plain = buildBsg({
			colorMode: MODE_BGRA,
			compressionMode: STORED,
			width: 3,
			height: 4,
			data: Buffer.alloc(3 * 4 * 4, 0x00),
		});
		const layout = layoutOf(plain);
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(4);
		expect(layout.offsetX).toBe(-3);
		expect(layout.offsetY).toBe(7);
		expect(layout.colorMode).toBe(MODE_BGRA);
		expect(layout.bitsPerPixel).toBe(32);
		expect(layout.dataOffset).toBe(DATA_AT);
		expect(layout.dataSize).toBe(3 * 4 * 4);

		const composed = buildBsg({
			composition: true,
			colorMode: MODE_INDEXED,
			compressionMode: STORED,
			width: 1,
			height: 1,
			data: Buffer.from([0]),
			palette: Buffer.alloc(0x400, 0x00),
		});
		const composedLayout = layoutOf(composed);
		expect(composedLayout.width).toBe(1);
		expect(composedLayout.bitsPerPixel).toBe(8);
		expect(composedLayout.dataOffset).toBe(DATA_AT);
		expect(composedLayout.paletteOffset).toBe(DATA_AT + 1);
	});

	it("refuses a header of an unknown colour mode or without its mark", () => {
		const unknown = buildBsg({
			colorMode: 3,
			compressionMode: STORED,
			width: 1,
			height: 1,
			data: Buffer.alloc(4, 0x00),
		});
		expect(readBsgLayout(unknown)).toBeUndefined();
		const noMark = buildBsg({
			colorMode: MODE_BGRA,
			compressionMode: STORED,
			width: 1,
			height: 1,
			data: Buffer.alloc(4, 0x00),
		});
		noMark.write("BSS-Nothing\0", 0, "latin1");
		expect(readBsgLayout(noMark)).toBeUndefined();
		expect(readBsgLayout(Buffer.alloc(0x20, 0x00))).toBeUndefined();
	});

	it("expands stored triplets into four byte pixels", () => {
		const file = buildBsg({
			colorMode: MODE_BGR,
			compressionMode: STORED,
			width: 2,
			height: 1,
			data: Buffer.from([10, 20, 30, 40, 50, 60]),
		});
		const pixels = decodeBsgPixels(file, layoutOf(file));
		expect([...pixels]).toEqual([10, 20, 30, 0, 40, 50, 60, 0]);
		const bmp = unpackBsgPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		expect([...bitmapPixels(bmp)]).toEqual([10, 20, 30, 40, 50, 60, 0, 0]);
	});

	it("writes a stored alpha channel and flips the rows", () => {
		const file = buildBsg({
			colorMode: MODE_BGRA,
			compressionMode: STORED,
			width: 2,
			height: 2,
			data: Buffer.from([
				1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
			]),
		});
		const bmp = unpackBsgPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.CreateFlipped` records its rows bottom up, which a positive height keeps.
		expect(bmp.readInt32LE(0x16)).toBe(2);
		expect([...bitmapPixels(bmp)]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
	});

	it("writes a colour mapped picture with the map it read", () => {
		const palette = Buffer.alloc(0x400, 0x00);
		palette.writeUInt32LE(0x00332211, 0);
		palette.writeUInt32LE(0x00665544, 4);
		const file = buildBsg({
			colorMode: MODE_INDEXED,
			compressionMode: STORED,
			width: 2,
			height: 1,
			data: Buffer.from([0, 1]),
			palette,
		});
		const bmp = unpackBsgPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readUInt32LE(0x2e)).toBe(256);
		expect([...bmp.subarray(0x36, 0x3e)]).toEqual([
			0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x00,
		]);
		expect([...bitmapPixels(bmp)]).toEqual([0, 1, 0, 0]);
	});

	it("reads a run coded channel of literals and repeats", () => {
		// The blue channel is four literals, the others one repeat of four apiece.
		const data = Buffer.concat([
			runsChannel([0x03, 10, 20, 30, 40]),
			runsChannel([0xfd, 0x50]),
			runsChannel([0xfd, 0x60]),
			runsChannel([0xfd, 0x70]),
		]);
		const file = buildBsg({
			colorMode: MODE_BGRA,
			compressionMode: RUN_CODED,
			width: 2,
			height: 2,
			data,
		});
		const pixels = decodeBsgPixels(file, layoutOf(file));
		expect([...pixels]).toEqual([
			10, 0x50, 0x60, 0x70, 20, 0x50, 0x60, 0x70, 30, 0x50, 0x60, 0x70, 40,
			0x50, 0x60, 0x70,
		]);
	});

	it("adds every sample of a walked channel to the one before it", () => {
		// The blue channel holds one sample and a reference that copies it three times, and the walk
		// then sums the plane: ten, twenty, thirty, forty. The other three channels stay clear.
		const data = Buffer.concat([
			walkChannel(0xee, [10, 0xee, 0x01, 0x03]),
			walkChannel(0xee, [0, 0, 0, 0]),
			walkChannel(0xee, [0, 0, 0, 0]),
			walkChannel(0xee, [0, 0, 0, 0]),
		]);
		const file = buildBsg({
			colorMode: MODE_BGRA,
			compressionMode: BACK_REFERENCED,
			width: 2,
			height: 2,
			data,
		});
		const pixels = decodeBsgPixels(file, layoutOf(file));
		expect([...pixels]).toEqual([
			10, 0, 0, 0, 20, 0, 0, 0, 30, 0, 0, 0, 40, 0, 0, 0,
		]);
	});

	it("refuses a compression mode it does not know", () => {
		const file = buildBsg({
			colorMode: MODE_BGRA,
			compressionMode: 3,
			width: 1,
			height: 1,
			data: Buffer.alloc(4, 0x00),
		});
		expect(() => decodeBsgPixels(file, layoutOf(file))).toThrow(GarbroError);
	});

	it("detects, lists and extracts through the registered format", async () => {
		const file = buildBsg({
			colorMode: MODE_BGR,
			compressionMode: STORED,
			width: 2,
			height: 1,
			data: Buffer.from([10, 20, 30, 40, 50, 60]),
		});
		await expect(
			bishopBsgImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		await expect(
			bishopBsgImageFormat.detect(new BufferByteSource(Buffer.alloc(0x80, 0))),
		).resolves.toBe(false);
		const archive = await bishopBsgImageFormat.open(
			new BufferByteSource(file),
			"picture.bsg",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual(["picture.bmp"]);
		expect(archive.metadata.colorMode).toBe(MODE_BGR);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await archive.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		await expect(
			bishopBsgImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x80, 0)),
				"picture.bsg",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
