import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { iafImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	convertIafCm,
	readIafLayout,
	renderIafImage,
	unpackIafBitmap,
} from "../../packages/formats/src/triangle/iaf-image.js";
import {
	readBmpImage,
	writeBmp8Palette,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";

interface IafParts {
	packed: Buffer;
	unpackedSize: number;
	packType: number;
	kind?: 1 | 2 | 3 | 4;
	offsetX?: number;
	offsetY?: number;
	/** What the head of the file names as the length of the packed picture, where it does not name the truth. */
	packedClaim?: number;
}

/**
 * A picture of this engine, of one of the four heads it writes. The head of the first three stands of a few
 * bytes in front of the picture and a tail behind it; the fourth stands of twelve bytes and no tail.
 */
function iafFile(parts: IafParts): Buffer {
	const packed = parts.packed;
	const unpacked = parts.unpackedSize | (parts.packType << 30) | 0;
	const kind = parts.kind ?? 4;
	if (1 === kind || 2 === kind) {
		const tailSize = 1 === kind ? 0x14 : 0xc;
		const unpackedPosition = 1 === kind ? 0x10 : 8;
		const head: Buffer = Buffer.alloc(5, 0x00);
		head.writeInt32LE(parts.packedClaim ?? packed.length, 1);
		const tail: Buffer = Buffer.alloc(tailSize, 0x00);
		tail.writeInt32LE(parts.offsetX ?? 0, 0);
		tail.writeInt32LE(parts.offsetY ?? 0, 4);
		tail.writeInt32LE(unpacked, unpackedPosition);
		return Buffer.concat([head, packed, tail]);
	}
	if (3 === kind) {
		const head: Buffer = Buffer.alloc(4, 0x00);
		head.writeInt32LE(parts.packedClaim ?? packed.length, 0);
		const tail: Buffer = Buffer.alloc(0xc, 0x00);
		tail.writeInt32LE(parts.offsetX ?? 0, 0);
		tail.writeInt32LE(parts.offsetY ?? 0, 4);
		tail.writeInt32LE(unpacked, 8);
		return Buffer.concat([head, packed, tail]);
	}
	const head: Buffer = Buffer.alloc(0xc, 0x00);
	head.writeInt32LE(parts.offsetX ?? 0, 0);
	head.writeInt32LE(parts.offsetY ?? 0, 4);
	head.writeInt32LE(unpacked, 8);
	return Buffer.concat([head, packed]);
}

/** The places of the walks of this engine's LZSS, of a picture standing of nothing but places as they are. */
function lzssLiterals(payload: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let at = 0; at < payload.length; at += 8) {
		const group = Math.min(8, payload.length - at);
		let control = 0;
		for (let bit = 0; bit < group; bit += 1) control |= 1 << bit;
		parts.push(Buffer.from([control]), payload.subarray(at, at + group));
	}
	return Buffer.concat(parts);
}

async function extract(data: Buffer, name = "cg.iaf"): Promise<Buffer> {
	const handle = await iafImageFormat.open(new BufferByteSource(data), name);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

async function imageOf(data: Buffer) {
	const image = readBmpImage(await extract(data));
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Triangle compressed bitmap", () => {
	it("reads the head of a picture and turns away the ones that stand of no picture", () => {
		const bmp = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), true);
		for (const kind of [1, 2, 3, 4] as const) {
			const layout = readIafLayout(
				iafFile({ packed: bmp, unpackedSize: bmp.length, packType: 1, kind }),
			);
			expect(layout?.width, `kind ${kind}`).toBe(2);
			expect(layout?.height, `kind ${kind}`).toBe(1);
			expect(layout?.bitsPerPixel, `kind ${kind}`).toBe(24);
			expect(layout?.packType, `kind ${kind}`).toBe(1);
		}
		const located = readIafLayout(
			iafFile({
				packed: bmp,
				unpackedSize: bmp.length,
				packType: 1,
				kind: 4,
				offsetX: 7,
				offsetY: -9,
			}),
		);
		expect(located?.offsetX).toBe(7);
		expect(located?.offsetY).toBe(-9);
		// The places of the picture standing too far from the corner of it, the kind of picture standing
		// of three, and a bitmap whose head is not one of the two this engine writes.
		expect(
			readIafLayout(
				iafFile({
					packed: bmp,
					unpackedSize: bmp.length,
					packType: 1,
					kind: 4,
					offsetX: 4097,
				}),
			),
		).toBeUndefined();
		expect(
			readIafLayout(
				iafFile({
					packed: bmp,
					unpackedSize: bmp.length,
					packType: 3,
					kind: 4,
				}),
			),
		).toBeUndefined();
		const wrong = Buffer.from(bmp);
		wrong.write("XY", 0, "latin1");
		expect(
			readIafLayout(
				iafFile({
					packed: wrong,
					unpackedSize: wrong.length,
					packType: 1,
					kind: 4,
				}),
			),
		).toBeUndefined();
		expect(readIafLayout(Buffer.alloc(4, 0x00))).toBeUndefined();
	});

	it("hands a picture whose bitmap stands as it stands over", async () => {
		const bmp = writeBmp24(
			2,
			2,
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
			true,
		);
		const image = await imageOf(
			iafFile({ packed: bmp, unpackedSize: bmp.length, packType: 1, kind: 1 }),
		);
		expect(image.bitsPerPixel).toBe(24);
		// The places of the bitmap stand from the bottom of the picture up, so the rows it holds show in
		// the picture the other way round.
		expect([...image.pixels]).toEqual([7, 8, 9, 10, 11, 12, 1, 2, 3, 4, 5, 6]);
		// The same picture, whose places stand of the walks of the engine's own LZSS.
		const walked = await imageOf(
			iafFile({
				packed: lzssLiterals(bmp),
				unpackedSize: bmp.length,
				packType: 0,
				kind: 2,
			}),
		);
		expect([...walked.pixels]).toEqual([...image.pixels]);
	});

	it("puts a picture whose place of a pixel stands of one colour at a time together", async () => {
		const width = 2;
		const height = 2;
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const bmp = writeBmp24(width, height, pixels, true);
		// The places of the bitmap stand of one colour at a time: every blue place, then every green one.
		const start = bmp.readInt32LE(0x0a);
		const stored = bmp.subarray(start, start + width * height * 3);
		const planar = Buffer.from(bmp);
		planar.write("CM", 0, "latin1");
		let at = start;
		for (let colour = 0; colour < 3; colour += 1) {
			for (let place = 0; place < width * height; place += 1) {
				planar[at] = stored[colour + place * 3] ?? 0;
				at += 1;
			}
		}
		expect([
			...convertIafCm(planar, width, height, 24).subarray(start, start + 12),
		]).toEqual([...stored]);
		const image = await imageOf(
			iafFile({
				packed: planar,
				unpackedSize: planar.length,
				packType: 1,
				kind: 3,
			}),
		);
		// The rows of the bitmap stand from the bottom of the picture up, and its places stand of the
		// colours they name, one place of a pixel after another.
		expect([...image.pixels]).toEqual([
			...pixels.subarray(width * 3),
			...pixels.subarray(0, width * 3),
		]);
	});

	it("stands the runs of the two kinds of its own", () => {
		// The first kind of runs stands of a control place in front of every run: nothing in it and the
		// place behind it names how many places stand as they are, and a place in it names as many places as
		// it says of the place behind it.
		const first = unpackIafBitmap(
			Buffer.from([0x02, 0xaa, 0x00, 0x02, 0x11, 0x22]),
			2,
			6,
			4,
		);
		expect([...first]).toEqual([0xaa, 0xaa, 0x11, 0x22]);
		// The second kind names the place and the count of every run, and opens with the word its kind is
		// told by; the runs of the word stand as the runs of the picture do.
		const second = unpackIafBitmap(
			Buffer.from([0x42, 0x41, 0x4d, 0x01, 0x7f, 0x04]),
			2,
			6,
			4,
		);
		expect([...second]).toEqual([0x42, 0x42, 0x42, 0x42]);
		// A run of the first kind naming more places than stand in the picture stops at the end of it.
		const short = unpackIafBitmap(
			Buffer.from([0x05, 0x7f, 0x00, 0x00]),
			2,
			4,
			3,
		);
		expect([...short]).toEqual([0x7f, 0x7f, 0x7f]);
	});

	it("takes the alpha of a picture from the colours of its own map", async () => {
		// A picture of three colours with an eight bit picture behind it: the places of the second name the
		// places of the first, and the alpha of a place stands of the colours of the map of the second.
		const width = 4;
		const height = 2;
		const pixels = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21,
			22, 23, 24,
		]);
		const first = writeBmp24(width, height, pixels, true);
		const indices = Buffer.from([
			0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70,
		]);
		const palette: Buffer = Buffer.alloc(0x400, 0x00);
		for (let at = 0; at < 0x100; at += 1) {
			palette[at * 4] = at;
			palette[at * 4 + 1] = at;
			palette[at * 4 + 2] = at;
		}
		const alpha = writeBmp8Palette(width, height, indices, palette, true);
		const data = iafFile({
			packed: Buffer.concat([first, alpha]),
			unpackedSize: first.length + alpha.length,
			packType: 1,
			kind: 1,
		});
		const image = await imageOf(data);
		expect(image.bitsPerPixel).toBe(32);
		// The alpha of a place stands one off the grey of the map of the eight bit picture, and the rows of
		// the picture stand from the bottom of it up.
		expect([...image.pixels]).toEqual([
			13,
			14,
			15,
			~0x40 & 0xff,
			16,
			17,
			18,
			~0x50 & 0xff,
			19,
			20,
			21,
			~0x60 & 0xff,
			22,
			23,
			24,
			~0x70 & 0xff,
			1,
			2,
			3,
			~0x00 & 0xff,
			4,
			5,
			6,
			~0x10 & 0xff,
			7,
			8,
			9,
			~0x20 & 0xff,
			10,
			11,
			12,
			~0x30 & 0xff,
		]);
	});

	it("hands a picture over as a bitmap and tells one by the head it stands of", async () => {
		const bmp = writeBmp24(1, 1, Buffer.from([9, 8, 7]));
		const data = iafFile({
			packed: bmp,
			unpackedSize: bmp.length,
			packType: 1,
			kind: 4,
		});
		expect(await iafImageFormat.detect?.(new BufferByteSource(data))).toBe(
			true,
		);
		expect(await iafImageFormat.detect?.(new BufferByteSource(bmp))).toBe(
			false,
		);
		expect(() => renderIafImage(bmp)).toThrow(/Triangle/);
	});
});
