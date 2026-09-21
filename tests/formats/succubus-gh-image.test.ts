import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	ghColorDepth,
	readGhLayout,
	succubusGhImageFormat,
} from "../../packages/formats/src/succubus/gh-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x28;
const DATA_AT = 0x40;
/** The palette of the fixtures stands behind the head, of three bytes a colour. */
const PALETTE_AT = HEADER_SIZE;
const COLOUR_BYTES = 3;

/**
 * The bits of a fixture, gathered the way the walk's own cache is: four bytes at a time, with the first of
 * them in the lowest byte, so the bits are then read from the top - the first bit asked for is the highest
 * bit of the last byte of the group.
 */
function bitsToBytes(bits: number[]): Buffer {
	const groups: Buffer[] = [];
	for (let at = 0; at < bits.length; at += 32) {
		const group = bits.slice(at, at + 32);
		let value = 0;
		for (const [index, bit] of group.entries()) {
			if (bit) value = (value | (1 << (31 - index))) >>> 0;
		}
		const out = Buffer.alloc(4, 0x00);
		out.writeUInt32LE(value, 0);
		groups.push(out);
	}
	return Buffer.concat(groups);
}

/** A palette whose colours are red first, as the format keeps them. */
function palette(colours: number): Buffer {
	const out = Buffer.alloc(colours * COLOUR_BYTES, 0x00);
	for (let index = 0; index < colours; index += 1) {
		out[index * 3 + 0] = index * 2 + 1;
		out[index * 3 + 1] = index * 2 + 2;
		out[index * 3 + 2] = index * 2 + 3;
	}
	return out;
}

function buildGh(options: {
	version: number;
	width: number;
	height: number;
	colours: number;
	chunkCount?: number;
	bits: number[];
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write(`GHP${options.version}`, 0, "latin1");
	head.writeUInt16LE(options.width, 0x0c);
	head.writeUInt16LE(options.height, 0x0e);
	head.writeUInt16LE(options.colours, 0x10);
	if (2 === options.version) {
		head.writeUInt32LE(PALETTE_AT, 0x14);
		head.writeInt32LE(options.chunkCount ?? 2, 0x18);
		head.writeUInt32LE(DATA_AT, 0x1c);
	} else {
		head.writeUInt32LE(PALETTE_AT, 0x18);
		head.writeUInt32LE(DATA_AT, 0x24);
	}
	const body = Buffer.alloc(
		DATA_AT - HEADER_SIZE - palette(options.colours).length,
		0x00,
	);
	return Buffer.concat([
		head,
		palette(options.colours),
		body,
		bitsToBytes(options.bits),
	]);
}

/**
 * The walk writes a pixel where its own number says, marks that place, and fills every place it never
 * marked with the value it wrote last: with two chunks read, the places are the first two rows' left
 * hand pixels, and the last value written fills the rest of those rows.
 */
const BITS_TWO_CHUNKS = [
	0,
	0,
	0, // the place read before the walk begins, which it leaves aside
	1, // the first value
	1,
	1, // a chunk marker, which brings its own count
	0, // the count's own length
	0,
	0,
	1, // the place of the next pixel: two rows along a picture two wide
	0, // the second value
	0,
	0,
	1, // the place of the value read behind it, which the walk never writes
	1,
];

/** The same walk with a third chunk, so the third pixel is written as well. */
const BITS_THREE_CHUNKS = [
	...BITS_TWO_CHUNKS,
	1,
	1, // a second chunk marker
	0, // its count's own length
	0,
	0,
	1, // the place behind the value already read
	1,
];

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await succubusGhImageFormat.open(
		new BufferByteSource(data),
		"picture.gh",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

function pixels(out: Buffer): Buffer {
	const image = readBmpImage(out);
	if (!image) throw new Error("the picture is not a bitmap");
	return image.pixels;
}

describe("Succubus image format", () => {
	it("reads the head of both versions", () => {
		const older = buildGh({
			version: 2,
			width: 2,
			height: 3,
			colours: 2,
			bits: BITS_TWO_CHUNKS,
		});
		expect(readGhLayout(older)).toMatchObject({
			version: 2,
			width: 2,
			height: 3,
			bitsPerPixel: 8,
			colours: 2,
			paletteOffset: PALETTE_AT,
			dataOffset: DATA_AT,
			depth: 1,
			stride: 4,
			chunkCount: 2,
		});
		const newer = buildGh({
			version: 3,
			width: 4,
			height: 5,
			colours: 4,
			bits: [0],
		});
		expect(readGhLayout(newer)).toMatchObject({
			version: 3,
			width: 4,
			height: 5,
			colours: 4,
			paletteOffset: PALETTE_AT,
			dataOffset: DATA_AT,
			depth: 2,
		});
	});

	it("takes the width of an index from the number of colours", () => {
		expect(ghColorDepth(1)).toBe(0);
		expect(ghColorDepth(2)).toBe(1);
		expect(ghColorDepth(16)).toBe(4);
		expect(ghColorDepth(17)).toBe(5);
		expect(ghColorDepth(0x100)).toBe(8);
	});

	it("writes the pixels the walk names and fills the rest with the last of them", async () => {
		const out = await extract(
			buildGh({
				version: 2,
				width: 2,
				height: 3,
				colours: 2,
				chunkCount: 2,
				bits: BITS_TWO_CHUNKS,
			}),
		);
		expect(pixels(out)).toEqual(Buffer.from([1, 1, 0, 0, 0, 0]));
	});

	it("writes one more pixel when the walk is given one more chunk", async () => {
		expect(
			readGhLayout(
				buildGh({
					version: 2,
					width: 2,
					height: 3,
					colours: 2,
					chunkCount: 3,
					bits: BITS_THREE_CHUNKS,
				}),
			)?.chunkCount,
		).toBe(3);
		const out = await extract(
			buildGh({
				version: 2,
				width: 2,
				height: 3,
				colours: 2,
				chunkCount: 3,
				bits: BITS_THREE_CHUNKS,
			}),
		);
		// The third pixel stands on the last row, so that row keeps its own value rather than the last one.
		expect(pixels(out)).toEqual(Buffer.from([1, 1, 0, 0, 1, 1]));
	});

	it("keeps the palette of a picture in the order the engine wrote it", async () => {
		const out = await extract(
			buildGh({
				version: 2,
				width: 2,
				height: 3,
				colours: 2,
				chunkCount: 2,
				bits: BITS_TWO_CHUNKS,
			}),
		);
		// The palette stands behind the bitmap's own header, four bytes an entry, blue first.
		expect([...out.subarray(0x36, 0x3a)]).toEqual([3, 2, 1, 0xff]);
		expect([...out.subarray(0x3a, 0x3e)]).toEqual([5, 4, 3, 0xff]);
	});

	it("turns away the version the reference itself leaves unwritten", async () => {
		const data = buildGh({
			version: 3,
			width: 4,
			height: 5,
			colours: 4,
			bits: [0],
		});
		await expect(
			succubusGhImageFormat.open(new BufferByteSource(data), "picture.gh"),
		).rejects.toThrow(GarbroError);
		// The head itself still reads, so a caller may tell the two versions apart.
		expect(readGhLayout(data)?.version).toBe(3);
	});

	it("turns away a file that is not a picture of this engine", () => {
		const good = buildGh({
			version: 2,
			width: 2,
			height: 3,
			colours: 2,
			bits: BITS_TWO_CHUNKS,
		});
		const wrongWord = Buffer.from(good);
		wrongWord.write("XXX\0", 0, "latin1");
		expect(readGhLayout(wrongWord)).toBeUndefined();
		const noSize = Buffer.from(good);
		noSize.writeUInt16LE(0, 0x0c);
		expect(readGhLayout(noSize)).toBeUndefined();
		expect(readGhLayout(good.subarray(0, HEADER_SIZE - 1))).toBeUndefined();
	});

	it("is told by the words of the picture", async () => {
		expect(succubusGhImageFormat.descriptor.id).toBe("succubus-gh-image");
		const good = buildGh({
			version: 2,
			width: 2,
			height: 3,
			colours: 2,
			bits: BITS_TWO_CHUNKS,
		});
		expect(
			await succubusGhImageFormat.detect(
				new BufferByteSource(good),
				"picture.gh",
			),
		).toBe(true);
		await expect(
			succubusGhImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x40, 0x00)),
				"picture.gh",
			),
		).rejects.toThrow(GarbroError);
	});
});
