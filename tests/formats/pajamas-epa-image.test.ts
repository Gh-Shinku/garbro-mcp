import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeEpaChannel,
	epaOffsetTable,
	pajamasEpaImageFormat,
	readEpaLayout,
	unpackEpaPicture,
} from "../../packages/formats/src/pajamas/epa-image.js";
import type { EpaLayout } from "../../packages/formats/src/pajamas/epa-image.js";

const HEADER_SIZE = 0x10;
const OFFSET_HEADER_SIZE = 0x18;
const PALETTE_BYTES = 0x300;

/** The simplest channel the reference reads: runs of up to fifteen literal bytes. */
function epaLiteralChannel(bytes: number[]): Buffer {
	const out: number[] = [];
	for (let at = 0; at < bytes.length; at += 15) {
		const run = bytes.slice(at, at + 15);
		out.push(run.length); // the high nibble stays clear, so this is a literal run
		out.push(...run);
	}
	return Buffer.from(out);
}

/** An `EPA` file: the header, a colour map for the one byte kinds, then the channels. */
function buildEpa(options: {
	mode?: number;
	colorType: number;
	width: number;
	height: number;
	palette?: Buffer;
	channels: Buffer[];
}): Buffer {
	const mode = options.mode ?? 1;
	const headerSize = 2 === mode ? OFFSET_HEADER_SIZE : HEADER_SIZE;
	const header = Buffer.alloc(headerSize, 0x00);
	header.writeUInt32LE(0x01015045 + ((mode - 1) << 24), 0);
	header[3] = mode;
	header[4] = options.colorType;
	header.writeUInt32LE(options.width, 8);
	header.writeUInt32LE(options.height, 12);
	if (2 === mode) {
		header.writeInt32LE(-7, 0x10);
		header.writeInt32LE(11, 0x14);
	}
	return Buffer.concat([
		header,
		options.palette ?? Buffer.alloc(0),
		...options.channels,
	]);
}

/** A colour map of the shape `PaletteFormat.Bgr` reads: three bytes to an entry. */
function palette(entries: [number, number, number][]): Buffer {
	const out = Buffer.alloc(PALETTE_BYTES, 0x00);
	entries.forEach((entry, index) => {
		out[index * 3] = entry[0];
		out[index * 3 + 1] = entry[1];
		out[index * 3 + 2] = entry[2];
	});
	return out;
}

function layoutOf(file: Buffer): EpaLayout {
	const layout = readEpaLayout(file);
	if (!layout) throw new Error("no layout");
	return layout;
}

describe("Pajamas Adventure System image", () => {
	it("reads the header, and refuses anything else", () => {
		const file = buildEpa({
			colorType: 1,
			width: 3,
			height: 4,
			channels: [epaLiteralChannel([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])],
		});
		const layout = layoutOf(file);
		expect(layout.mode).toBe(1);
		expect(layout.colorType).toBe(1);
		expect(layout.pixelSize).toBe(3);
		expect(layout.bitsPerPixel).toBe(24);
		expect(layout.hasAlpha).toBe(false);
		expect(layout.width).toBe(3);
		expect(layout.height).toBe(4);
		expect(readEpaLayout(Buffer.alloc(0x40, 0x00))).toBeUndefined();
		expect(readEpaLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
		const unknown = buildEpa({
			colorType: 5,
			width: 1,
			height: 1,
			channels: [epaLiteralChannel([1])],
		});
		expect(readEpaLayout(unknown)).toBeUndefined();
	});

	it("takes the mode and the offsets of a mode two file from its header", () => {
		const file = buildEpa({
			mode: 2,
			colorType: 2,
			width: 1,
			height: 1,
			channels: [epaLiteralChannel([1, 2, 3, 4])],
		});
		const layout = layoutOf(file);
		expect(layout.mode).toBe(2);
		expect(layout.pixelSize).toBe(4);
		expect(layout.bitsPerPixel).toBe(32);
		expect(layout.offsetX).toBe(-7);
		expect(layout.offsetY).toBe(11);
	});

	it("names the five colour types the reference names", () => {
		const expected: [number, number, number][] = [
			[0, 1, 8],
			[1, 3, 24],
			[2, 4, 32],
			[3, 2, 16],
			[4, 1, 8],
		];
		for (const [colorType, pixelSize, bits] of expected) {
			const file = buildEpa({
				colorType,
				width: 1,
				height: 1,
				channels: [epaLiteralChannel([1]), epaLiteralChannel([2])],
			});
			const layout = layoutOf(file);
			expect(layout.pixelSize).toBe(pixelSize);
			expect(layout.bitsPerPixel).toBe(bits);
			expect(layout.hasAlpha).toBe(4 === colorType);
		}
	});

	it("builds the offset table from the width", () => {
		const table = epaOffsetTable(4);
		expect(table[0]).toBe(0);
		expect(table[1]).toBe(1);
		expect(table[2]).toBe(4);
		expect(table[3]).toBe(5);
		expect(table[4]).toBe(2);
		expect(table[5]).toBe(3);
		expect(table[6]).toBe(8);
		expect(table[7]).toBe(3);
		expect(table[8]).toBe(10);
		expect(table[9]).toBe(6);
		expect(table[10]).toBe(9);
		expect(table[11]).toBe(7);
		expect(table[12]).toBe(6);
		expect(table[13]).toBe(2);
		expect(table[14]).toBe(12);
		expect(table[15]).toBe(4);
	});

	it("decodes literal runs and back references", () => {
		// A literal of three bytes, then a back reference of three from one byte behind, which repeats
		// the byte it has just written; then a literal of one, then a long reference of thirty two.
		const stream = Buffer.from([
			0x03, 0xaa, 0xbb, 0xcc, 0x13, 0x01, 0xdd, 0x18, 0x20,
		]);
		const { output } = decodeEpaChannel(stream, 0, 39, 1024);
		expect([...output.subarray(0, 8)]).toEqual([
			0xaa, 0xbb, 0xcc, 0xcc, 0xcc, 0xcc, 0xdd, 0xdd,
		]);
		expect(output.subarray(7).every((byte) => 0xdd === byte)).toBe(true);
	});

	it("stops a reference that would leave the channel and refuses an empty one", () => {
		// A reference of one byte from one behind fits the last byte exactly.
		const fits = Buffer.from([0x02, 0xaa, 0xbb, 0x11]);
		expect([...decodeEpaChannel(fits, 0, 3, 1024).output]).toEqual([
			0xaa, 0xbb, 0xbb,
		]);
		// A reference of seven no longer fits, and the channel is left where it stood.
		const stops = Buffer.from([0x02, 0xaa, 0xbb, 0x17]);
		const { output } = decodeEpaChannel(stops, 0, 3, 1024);
		expect([...output]).toEqual([0xaa, 0xbb, 0x00]);
		// A flag whose high nibble is set and whose count is zero asks for nothing at all.
		const empty = Buffer.from([0x10, 0x00]);
		expect(() => decodeEpaChannel(empty, 0, 4, 1024)).toThrow(GarbroError);
		// A flag of zero is a literal run of nothing, which the reference walks past.
		const skipped = Buffer.from([0x00, 0x02, 0x66, 0x77]);
		expect([...decodeEpaChannel(skipped, 0, 2, 1024).output]).toEqual([
			0x66, 0x77,
		]);
	});

	it("writes an eight bit picture with the colour map it read", () => {
		const file = buildEpa({
			colorType: 0,
			width: 2,
			height: 2,
			palette: palette([
				[0x11, 0x22, 0x33],
				[0x44, 0x55, 0x66],
			]),
			channels: [epaLiteralChannel([0, 1, 1, 0])],
		});
		const bmp = unpackEpaPicture(file, layoutOf(file));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readUInt32LE(0x2e)).toBe(256);
		expect(bmp.readUInt32LE(0x0a)).toBe(0x36 + 0x400);
		// The colour map is stored as four byte quads, the first two entries carrying what was read.
		expect([...bmp.subarray(0x36, 0x3e)]).toEqual([
			0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x00,
		]);
		// Rows of two pixels are padded to four bytes.
		expect([...bmp.subarray(0x436, 0x43e)]).toEqual([0, 1, 0, 0, 1, 0, 0, 0]);
		expect(bmp.readInt32LE(0x16)).toBe(-2);
	});

	it("weaves the planes of a three byte picture", () => {
		const file = buildEpa({
			colorType: 1,
			width: 2,
			height: 1,
			channels: [epaLiteralChannel([1, 2, 3, 4, 5, 6])],
		});
		const bmp = unpackEpaPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		// Plane by plane: two blues, two greens, two reds, woven back into pixels and padded a row.
		expect([...bmp.subarray(0x36, 0x3e)]).toEqual([1, 3, 5, 2, 4, 6, 0, 0]);
	});

	it("weaves a two byte picture with the reference's own expressions", () => {
		const file = buildEpa({
			colorType: 3,
			width: 1,
			height: 1,
			channels: [epaLiteralChannel([0x0f, 0xe0])],
		});
		const bmp = unpackEpaPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(16);
		// Six green bits, which the writer declares as masks.
		expect(bmp.readUInt32LE(0x36)).toBe(0xf800);
		expect(bmp.readUInt32LE(0x3a)).toBe(0x07e0);
		expect(bmp.readUInt32LE(0x3e)).toBe(0x001f);
		// With the two channel bytes 0x0f and 0xe0 the first pixel byte is (0xe0 & 3) |
		// ((0x0f & 7 | (0xe0 & 0xfc) << 1) << 2), whose low byte is 0x1c, and the second is
		// (0x0f & 0xc0) | ((0xe0 & 0xe3 | (0x0f >> 1) & 0x1c) >> 2), i.e. (0xe0 | 4) >> 2, or 0x39.
		expect([...bmp.subarray(0x42, 0x46)]).toEqual([0x1c, 0x39, 0x00, 0x00]);
	});

	it("reads a second channel for an alpha colour type", () => {
		const file = buildEpa({
			colorType: 4,
			width: 2,
			height: 1,
			palette: palette([
				[0x11, 0x22, 0x33],
				[0x44, 0x55, 0x66],
			]),
			channels: [epaLiteralChannel([0, 1]), epaLiteralChannel([0xaa, 0xbb])],
		});
		const bmp = unpackEpaPicture(file, layoutOf(file));
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
		expect([...bmp.subarray(0x36, 0x3e)]).toEqual([
			0x11, 0x22, 0x33, 0xaa, 0x44, 0x55, 0x66, 0xbb,
		]);
	});

	it("refuses a picture without its colour map", () => {
		const file = buildEpa({
			colorType: 0,
			width: 1,
			height: 1,
			channels: [epaLiteralChannel([0])],
		});
		expect(() =>
			unpackEpaPicture(file.subarray(0, HEADER_SIZE + 4), layoutOf(file)),
		).toThrow(GarbroError);
	});

	it("detects, lists and extracts through the registered format", async () => {
		const file = buildEpa({
			colorType: 1,
			width: 2,
			height: 1,
			channels: [epaLiteralChannel([1, 2, 3, 4, 5, 6])],
		});
		await expect(
			pajamasEpaImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		await expect(
			pajamasEpaImageFormat.detect(new BufferByteSource(Buffer.alloc(0x40, 0))),
		).resolves.toBe(false);
		const archive = await pajamasEpaImageFormat.open(
			new BufferByteSource(file),
			"picture.epa",
		);
		expect(archive.entries.map((entry) => entry.path)).toEqual(["picture.bmp"]);
		expect(archive.metadata.mode).toBe(1);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const bmp = await consumeBuffer(await archive.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect([...bmp.subarray(0x36, 0x3c)]).toEqual([1, 3, 5, 2, 4, 6]);
		await expect(
			pajamasEpaImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0)),
				"picture.epa",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
