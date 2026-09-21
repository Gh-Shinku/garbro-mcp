import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	adv98GpcImageFormat,
	decodeGpc,
	readGpcLayout,
} from "../../packages/formats/src/adv98/gpc-image.js";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x20;
const INFO_SIZE = 0x10;
const BMP_BPP_FIELD = 0x1c;
const BMP_HEIGHT_FIELD = 0x16;
const BMP_PALETTE = 0x36;

/** The packed walk: a control byte covers eight groups of eight bytes, its bits taken from the highest, and a
 * group whose bit is set is described by a command byte whose own bits say which of its eight bytes are
 * stored. Every group here is stored as it stands. */
function packPixels(rows: readonly Buffer[]): Buffer {
	const groups: { command: number; values: Buffer }[] = [];
	for (const row of rows) {
		let at = 0;
		while (at < row.length) {
			const group = row.subarray(at, Math.min(at + 8, row.length));
			let command = 0;
			for (let index = 0; index < group.length; index += 1) {
				command |= 0x80 >> index;
			}
			groups.push({ command, values: Buffer.from(group) });
			at += 8;
		}
	}
	const parts: Buffer[] = [];
	for (let start = 0; start < groups.length; start += 8) {
		const window = groups.slice(start, start + 8);
		let control = 0;
		for (let index = 0; index < window.length; index += 1) {
			control |= 0x80 >> index;
		}
		parts.push(Buffer.from([control]));
		for (const group of window) {
			parts.push(Buffer.from([group.command]), group.values);
		}
	}
	return Buffer.concat(parts);
}

interface GpcFixture {
	width: number;
	height: number;
	interleaving?: number;
	palette?: readonly number[];
	/** The rows of the packed picture, the first byte of each the step its threads are woven by. */
	rows: readonly Buffer[];
	/** A packed stream written by hand, which takes the place of the rows. */
	stream?: Buffer;
}

function gpcFile(options: GpcFixture): Buffer {
	const info = Buffer.alloc(INFO_SIZE, 0x00);
	info.writeUInt16LE(options.width, 0);
	info.writeUInt16LE(options.height, 2);
	info.writeInt16LE(3, 0x0a);
	info.writeInt16LE(5, 0x0c);
	const palette = options.palette ?? [0x000, 0x0f0];
	const paletteBlock = Buffer.alloc(4 + palette.length * 2, 0x00);
	paletteBlock.writeUInt16LE(palette.length, 0);
	paletteBlock.writeUInt16LE(2, 2);
	for (const [index, word] of palette.entries()) {
		paletteBlock.writeUInt16LE(word, 4 + index * 2);
	}
	const pixels = options.stream ?? packPixels(options.rows);
	const header = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("PC98", 0, "latin1");
	header.write(")GPCFILE   \0", 4, "latin1");
	header.writeUInt16LE(options.interleaving ?? 0, 0x10);
	header.writeUInt32LE(HEADER_SIZE + INFO_SIZE + pixels.length, 0x14);
	header.writeUInt32LE(HEADER_SIZE, 0x18);
	return Buffer.concat([header, info, pixels, paletteBlock]);
}

function layoutOf(file: Buffer) {
	const layout = readGpcLayout(file);
	if (!layout) throw new Error("the fixture does not read as an Adv98 picture");
	return layout;
}

/** The pixels of a four bit bitmap, with the row padding taken out. */
function bmpPixels(bmp: Buffer, height: number): Buffer {
	const width = bmp.readInt32LE(0x12);
	const rowBytes = (width + 1) >> 1;
	const stride = (rowBytes + 3) & ~3;
	const first = bmp.readUInt32LE(0x0a);
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		const at = first + row * stride;
		out.push(...bmp.subarray(at, at + rowBytes));
	}
	return Buffer.from(out);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await adv98GpcImageFormat.open(
		new BufferByteSource(file),
		"picture.gpc",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("Adv98 GPC picture", () => {
	it("weaves four planes of one bit into four bit pixels", async () => {
		// The row is the step its threads are woven by, then one byte to a plane.
		const row = Buffer.from([
			0x00, 0b10101010, 0b11001100, 0b11110000, 0b11111111,
		]);
		const file = gpcFile({ width: 8, height: 1, rows: [row] });
		const layout = layoutOf(file);
		expect(layout.interleaving).toBe(0);
		expect(layout.planeStride).toBe(1);
		expect(layout.rowSize).toBe(5);
		const { pixels, palette } = decodeGpc(file, layout);
		// These are the reference's own expressions worked out by hand over the four plane bytes.
		expect(pixels).toEqual(Buffer.from([0xfe, 0xdc, 0xba, 0x98]));
		// Every colour is four bits to a part, widened by seventeen.
		expect(palette.subarray(0, 6)).toEqual(Buffer.from([0, 0, 0, 0xff, 0, 0]));
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(4);
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(-1);
		expect(bmpPixels(bmp, 1)).toEqual(Buffer.from([0xfe, 0xdc, 0xba, 0x98]));
		// A bitmap names its colours blue first.
		expect(bmp.subarray(BMP_PALETTE, BMP_PALETTE + 8)).toEqual(
			Buffer.from([0, 0, 0, 0, 0, 0, 0xff, 0]),
		);
	});

	it("accumulates the bytes of a row along the threads the first byte names", () => {
		// A step of two weaves the bytes behind the first into two threads, each accumulated with the one
		// before it along its own thread, so a row of ones becomes ones and then nothing.
		const row = Buffer.from([2, 0xff, 0xff, 0xff, 0xff]);
		const file = gpcFile({ width: 8, height: 1, rows: [row] });
		const { pixels } = decodeGpc(file, layoutOf(file));
		// The first two planes come out set, which is the first two of a pixel's four bits.
		expect(pixels).toEqual(Buffer.from([0x33, 0x33, 0x33, 0x33]));
	});

	it("accumulates every row behind the first with the row above it", () => {
		// The second row is stored as nothing, and the row above it as a byte of ones, so the second row
		// becomes a byte of ones of its own.
		const first = Buffer.from([0, 0xff, 0, 0, 0]);
		const second = Buffer.from([0, 0x00, 0, 0, 0]);
		const file = gpcFile({ width: 8, height: 2, rows: [first, second] });
		const { pixels } = decodeGpc(file, layoutOf(file));
		// The rows stand nothing apart, so the second takes the place of the first, which is what the
		// reference's own step of nothing does. The first plane comes out as the lowest bit of a pixel.
		expect(pixels.subarray(0, 4)).toEqual(
			Buffer.from([0x11, 0x11, 0x11, 0x11]),
		);
		expect(pixels.subarray(4, 8)).toEqual(Buffer.alloc(4, 0x00));
	});

	it("lists the picture as one bitmap and reports what it holds", async () => {
		const file = gpcFile({
			width: 8,
			height: 1,
			interleaving: 2,
			rows: [Buffer.from([0, 1, 2, 3, 4])],
		});
		await expectArchive({
			format: adv98GpcImageFormat,
			archive: file,
			sourcePath: "face.gpc",
			entries: [{ path: "face.bmp", size: file.length }],
			metadata: {
				image: "bmp",
				width: 8,
				height: 1,
				bitsPerPixel: 4,
				interleaving: 2,
				offsetX: 3,
				offsetY: 5,
			},
		});
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = gpcFile({
			width: 8,
			height: 1,
			rows: [Buffer.from([0, 1, 2, 3, 4])],
		});
		const withField = (offset: number, value: number, width: 2 | 4): Buffer => {
			const copy = Buffer.from(good);
			if (2 === width) copy.writeUInt16LE(value, offset);
			else copy.writeUInt32LE(value, offset);
			return copy;
		};
		const withText = (offset: number, text: string): Buffer => {
			const copy = Buffer.from(good);
			copy.write(text, offset, "latin1");
			return copy;
		};
		const paletteAt = good.readUInt32LE(0x14);
		expect(
			await adv98GpcImageFormat.detect(new BufferByteSource(good), "a.gpc"),
		).toBe(true);
		for (const candidate of [
			Buffer.from("PC99", "latin1"),
			withText(4, ")GPCFILE  \0"),
			withField(paletteAt, 0, 2),
			withField(paletteAt, 17, 2),
			withField(paletteAt + 2, 3, 2),
			withField(0x18, good.length, 4),
			withField(0x18, 0x1000, 4),
			good.subarray(0, HEADER_SIZE - 1),
		]) {
			expect(
				await adv98GpcImageFormat.detect(
					new BufferByteSource(candidate),
					"a.gpc",
				),
			).toBe(false);
		}
	});

	it("refuses a group that stores more than the picture holds", () => {
		// Four bytes of picture and eight stored, so the group runs out of the picture before its command
		// byte is done.
		const file = gpcFile({
			width: 8,
			height: 1,
			rows: [Buffer.alloc(5)],
			stream: Buffer.from([0x80, 0xff, 1, 2, 3, 4, 5, 6, 7, 8]),
		});
		expect(() => decodeGpc(file, layoutOf(file))).toThrow(GarbroError);
	});
});
