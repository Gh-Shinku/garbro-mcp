import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { elfGccImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readGccLayout } from "../../packages/formats/src/elf/gcc-image.js";
import { literalLzssStream } from "../helpers/lzss.js";

/**
 * A picture of the engine: the head of it, the places of the words of the LZSS walk of its colours and,
 * where the picture stands of a mask, the walks of the alpha of it.
 */
function gccFile(input: {
	signature: string;
	width: number;
	height: number;
	offsetX?: number;
	offsetY?: number;
	pixels: Buffer;
	alpha?: { width: number; height: number; bits: number[]; places: number[] };
}): Buffer {
	// The places of the words of the walk of the colours of a picture stand at 0x14, and of a picture of
	// a mask at 0x20, behind the places of the head of the walk of the alpha of it.
	const head: Buffer = Buffer.alloc(input.alpha ? 0x20 : 0x14, 0x00);
	head.write(input.signature, 0, "latin1");
	head.writeInt16LE(input.offsetX ?? 0, 4);
	head.writeInt16LE(input.offsetY ?? 0, 6);
	head.writeUInt16LE(input.width, 8);
	head.writeUInt16LE(input.height, 10);
	const walk = literalLzssStream(input.pixels);
	if (!input.alpha) {
		return Buffer.concat([head, walk]);
	}
	head.writeUInt16LE(input.alpha.width, 0x18);
	head.writeUInt16LE(input.alpha.height, 0x1a);
	head.writeInt32LE(walk.length, 0x0c);
	head.writeInt32LE(input.alpha.bits.length, 0x1c);
	return Buffer.concat([
		head,
		walk,
		Buffer.from(input.alpha.bits),
		Buffer.from(input.alpha.places),
	]);
}

async function bytesOf(data: Buffer): Promise<Buffer> {
	const handle = await elfGccImageFormat.open(
		new BufferByteSource(data),
		"cg.g24",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

/**
 * The places of the colours of a picture, of the rows of it the highest place of the file first: every row
 * of the places of the file stands of four places of the file four places over.
 */
function rowsOfBmp(bytes: Buffer, width: number, height: number): number[] {
	const stride = (width * 3 + 3) & ~3;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let at = 0; at < width * 3; at += 1) {
			out.push(bytes[0x36 + row * stride + at] ?? 0);
		}
	}
	return out;
}

/** The places of a picture of a place of the file each, of the rows of it in the same order. */
function wordsOfBmp(bytes: Buffer, width: number, height: number): number[] {
	const out: number[] = [];
	for (let place = 0; place < width * height; place += 1) {
		for (let at = 0; at < 4; at += 1) {
			out.push(bytes[0x36 + place * 4 + at] ?? 0);
		}
	}
	return out;
}

/** The places of a picture of two rows, of the row of the file the last first. */
function rowsOf(width: number, height: number): Buffer {
	const rows: number[] = [];
	for (let row = 0; row < height; row += 1) {
		for (let x = 0; x < width; x += 1) {
			const place = row * width + x;
			rows.push(place * 3 + 1, place * 3 + 2, place * 3 + 3);
		}
	}
	return Buffer.from(rows);
}

/** The places of a picture of two rows, of the row of the display the first. */
function displayOf(width: number, height: number): number[] {
	const file = rowsOf(width, height);
	const out: number[] = [];
	for (let row = height - 1; row >= 0; row -= 1) {
		for (let place = 0; place < width; place += 1) {
			const at = (row * width + place) * 3;
			out.push(file[at] ?? 0, file[at + 1] ?? 0, file[at + 2] ?? 0);
		}
	}
	return out;
}

describe("AI5WIN engine image", () => {
	it("reads the head of a picture and the walk of the places of it", () => {
		const layout = readGccLayout(
			gccFile({ signature: "G24n", width: 2, height: 2, pixels: rowsOf(2, 2) }),
		);
		expect(layout).toMatchObject({
			offsetX: 0,
			offsetY: 0,
			width: 2,
			height: 2,
			masked: false,
			alt: false,
		});
		const masked = readGccLayout(
			gccFile({
				signature: "R24m",
				width: 2,
				height: 2,
				offsetX: 3,
				offsetY: 4,
				pixels: rowsOf(2, 2),
			}),
		);
		expect(masked).toMatchObject({
			offsetX: 3,
			offsetY: 4,
			masked: true,
			alt: true,
		});
		// A picture of a mark the engine knows none of and one of no places of the file of its own.
		expect(
			readGccLayout(
				gccFile({
					signature: "G24x",
					width: 2,
					height: 2,
					pixels: rowsOf(2, 2),
				}),
			),
		).toBeUndefined();
		expect(
			readGccLayout(
				gccFile({
					signature: "G24n",
					width: 0,
					height: 2,
					pixels: Buffer.alloc(0),
				}),
			),
		).toBeUndefined();
	});

	it("reads the places of a picture of the walk of the colours of it", async () => {
		const data = gccFile({
			signature: "G24n",
			width: 2,
			height: 2,
			pixels: rowsOf(2, 2),
		});
		const bytes = await bytesOf(data);
		// The walk of the file stands of the places of the picture of the lowest row of the display first.
		expect(rowsOfBmp(bytes, 2, 2)).toEqual(displayOf(2, 2));
	});

	it("reads the alpha of a picture of the walk of the places of it", async () => {
		const data = gccFile({
			signature: "G24m",
			width: 2,
			height: 2,
			pixels: rowsOf(2, 2),
			alpha: {
				width: 2,
				height: 2,
				// Every place of the alpha stands of a place of the file of its own.
				bits: [0x00],
				places: [0x10, 0x20, 0x30, 0x40],
			},
		});
		const bytes = await bytesOf(data);
		// The alpha of a picture of the places of the file stands of the four places of a place, of the
		// place of the display the last first.
		const file = displayOf(2, 2);
		// The alpha of the picture stands of the places of the file of the row of it the last first as well.
		const alphaRows: number[][] = [
			[0x10, 0x20],
			[0x30, 0x40],
		];
		const expected: number[] = [];
		for (let row = 0; row < 2; row += 1) {
			for (let place = 0; place < 2; place += 1) {
				const at = (row * 2 + place) * 3;
				expected.push(
					file[at] ?? 0,
					file[at + 1] ?? 0,
					file[at + 2] ?? 0,
					alphaRows[1 - row]?.[place] ?? 0,
				);
			}
		}
		expect(wordsOfBmp(bytes, 2, 2)).toEqual(expected);
	});

	it("stands of the places of the colours of a picture of an alpha of no places of it", async () => {
		const data = gccFile({
			signature: "G24m",
			width: 2,
			height: 2,
			pixels: rowsOf(2, 2),
			alpha: { width: 1, height: 1, bits: [0x00], places: [0x77] },
		});
		const bytes = await bytesOf(data);
		expect(rowsOfBmp(bytes, 2, 2)).toEqual(displayOf(2, 2));
	});

	it("stands of the walk of the places of the slots of an R24 picture", async () => {
		const data = gccFile({
			signature: "R24n",
			width: 2,
			height: 2,
			pixels: rowsOf(2, 2),
		});
		await expect(bytesOf(data)).rejects.toThrow(GarbroError);
	});

	it("tells a picture of the engine by the head of it", async () => {
		const data = gccFile({
			signature: "G24n",
			width: 2,
			height: 2,
			pixels: rowsOf(2, 2),
		});
		expect(await elfGccImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(
			await elfGccImageFormat.detect?.(
				new BufferByteSource(Buffer.from("G24x", "latin1")),
			),
		).toBe(false);
		await expect(
			elfGccImageFormat.open(
				new BufferByteSource(Buffer.from("G24x", "latin1")),
				"cg.g24",
			),
		).rejects.toThrow(GarbroError);
	});
});
