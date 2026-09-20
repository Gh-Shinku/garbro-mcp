import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeG00Image,
	readG00ImageLayout,
	realliveG00ImageFormat,
} from "../../packages/formats/src/reallive/g00-image.js";
import { expectArchive } from "../helpers/archive.js";

const TYPE_FIELD_INDEX = 0;
const BODY_FIELD = 5;
const BMP_PALETTE = 0x36;
const BMP_BPP_FIELD = 0x1c;
const BMP_HEIGHT_FIELD = 0x16;

/** The control bits of a stream, packed the way the unpacker takes them: the low bit of a byte first. */
function controlBytes(bits: readonly number[]): Buffer {
	const out: Buffer = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (!bit) continue;
		const at = index >> 3;
		out[at] = (out[at] ?? 0) | (1 << (index & 7));
	}
	return out;
}

/** A packed stream: its own length behind the word that counts it, the control bits, then the steps. */
function packedStream(
	unpackedSize: number,
	bits: readonly number[],
	data: Buffer,
): Buffer {
	const controls = controlBytes(bits);
	const header = Buffer.alloc(8);
	header.writeInt32LE(8 + controls.length + data.length, 0);
	header.writeInt32LE(unpackedSize, 4);
	return Buffer.concat([header, controls, data]);
}

/**
 * Every step of this stream stores its unit as it stands. The control bytes sit in the same stream as the
 * steps, one before each eight of them, which is where the unpacker asks for one.
 */
function literalStream(bytes: Buffer, bytesPerPixel: number): Buffer {
	const steps = bytes.length / bytesPerPixel;
	if (!Number.isInteger(steps)) {
		throw new Error("the units do not fill the stream");
	}
	const parts: Buffer[] = [];
	let step = 0;
	while (step < steps) {
		const run = Math.min(8, steps - step);
		parts.push(Buffer.from([0xff >> (8 - run)]));
		parts.push(
			bytes.subarray(step * bytesPerPixel, (step + run) * bytesPerPixel),
		);
		step += run;
	}
	const body = Buffer.concat(parts);
	const header = Buffer.alloc(8);
	header.writeInt32LE(8 + body.length, 0);
	header.writeInt32LE(bytes.length, 4);
	return Buffer.concat([header, body]);
}

/** A file: the type, the dimensions, then whatever the body holds. */
/** A file: the type and the dimensions, then the body, which opens with what the kind puts there. */
function g00File(
	type: number,
	width: number,
	height: number,
	body: Buffer,
): Buffer {
	// A stored or indexed body opens with the size of its packed stream, which is the word the header
	// checks; a tiled one opens with the number of tiles.
	const header = Buffer.alloc(BODY_FIELD);
	header[TYPE_FIELD_INDEX] = type;
	header.writeUInt16LE(width, 1);
	header.writeUInt16LE(height, 3);
	return Buffer.concat([header, body]);
}

function layoutOf(file: Buffer) {
	const layout = readG00ImageLayout(file);
	if (!layout)
		throw new Error("the fixture does not read as a RealLive picture");
	return layout;
}

/** The pixels of a bitmap the port produced, with the row padding taken out. */
function bmpPixels(
	bmp: Buffer,
	width: number,
	height: number,
	pixelSize: number,
): Buffer {
	const stride =
		pixelSize === 1
			? (width + 3) & ~3
			: pixelSize === 3
				? (width * 3 + 3) & ~3
				: width * 4;
	const out: number[] = [];
	const first = bmp.readUInt32LE(0x0a);
	for (let row = 0; row < height; row += 1) {
		const at = first + row * stride;
		out.push(...bmp.subarray(at, at + width * pixelSize));
	}
	return Buffer.from(out);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await realliveG00ImageFormat.open(
		new BufferByteSource(file),
		"picture.g00",
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

describe("RealLive G00 image", () => {
	it("unfolds a stored picture as pixels of three bytes", async () => {
		const values = new Array<number>(24).fill(0).map((_, index) => index + 1);
		const file = g00File(0, 4, 2, literalStream(Buffer.from(values), 3));
		const layout = layoutOf(file);
		expect(layout.bitsPerPixel).toBe(24);
		expect(decodeG00Image(file, layout).pixels).toEqual(Buffer.from(values));
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(24);
		// The rows are unpacked from the top down, so the bitmap says so with a negative height.
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(-2);
		expect(bmpPixels(bmp, 4, 2, 3)).toEqual(Buffer.from(values));
	});

	it("refuses a stored picture that unfolds to fewer pixels than it declares", () => {
		// Three pixels a row over two rows need eighteen bytes, and only twelve unfold.
		const file = g00File(
			0,
			3,
			2,
			literalStream(Buffer.from(new Array<number>(12).fill(9)), 3),
		);
		expect(() => decodeG00Image(file, layoutOf(file))).toThrow(GarbroError);
	});

	it("copies a run out of the pixels before it", () => {
		// Two pixels unfold as they stand, the third is one pixel taken from two pixels back, and the fourth
		// is stored again.
		const file = g00File(
			0,
			4,
			1,
			packedStream(
				12,
				[1, 1, 0, 1],
				Buffer.from([1, 2, 3, 4, 5, 6, 0x20, 0x00, 7, 8, 9]),
			),
		);
		expect(decodeG00Image(file, layoutOf(file)).pixels).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 1, 2, 3, 7, 8, 9]),
		);
	});

	it("unfolds an indexed picture with the palette it carries", async () => {
		const content = Buffer.concat([
			Buffer.from([3, 0]),
			Buffer.from([0x11, 0x22, 0x33, 0xaa, 0x44, 0x55, 0x66, 0xbb]),
			Buffer.from([0x77, 0x88, 0x99, 0xcc]),
			Buffer.from([0, 1, 2, 1]),
		]);
		const file = g00File(1, 4, 1, literalStream(content, 1));
		const layout = layoutOf(file);
		expect(layout.bitsPerPixel).toBe(8);
		const { pixels, palette } = decodeG00Image(file, layout);
		expect(pixels).toEqual(Buffer.from([0, 1, 2, 1]));
		expect(palette).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x00, 0x77, 0x88, 0x99, 0x00,
			]),
		);
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(8);
		expect(bmpPixels(bmp, 4, 1, 1)).toEqual(Buffer.from([0, 1, 2, 1]));
		// The bitmap names the colours blue first, and the alpha byte the format keeps is dropped.
		expect(bmp.subarray(BMP_PALETTE, BMP_PALETTE + 12)).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x00, 0x44, 0x55, 0x66, 0x00, 0x77, 0x88, 0x99, 0x00,
			]),
		);
	});

	it("lays the pieces of a tiled picture where the tile and the piece place them", () => {
		const table = Buffer.alloc(4 + 8 + 4 + 0x70 + 0x5c + 16, 0x00);
		table.writeInt32LE(1, 0); // one tile
		table.writeUInt32LE(12, 4); // where its block stands
		table.writeInt32LE(1, 8); // and that it is not empty
		const block = 12;
		table.writeUInt16LE(1, block); // the kind of tile
		table.writeUInt16LE(1, block + 2); // one piece
		const piece = block + 4 + 0x70;
		table.writeUInt16LE(1, piece); // two pixels across, from the first column
		table.writeUInt16LE(2, piece + 2); // and two down, from the second row
		table.writeUInt16LE(2, piece + 6);
		table.writeUInt16LE(2, piece + 8);
		const body = piece + 0x5c;
		for (let index = 0; index < 16; index += 1) {
			table[body + index] = 0x10 + index;
		}
		const tiles = Buffer.alloc(4 + 0x18);
		tiles.writeInt32LE(1, 0); // the one tile
		tiles.writeInt32LE(0, 4); // placed at the corner
		tiles.writeInt32LE(0, 8);
		const file = g00File(
			2,
			3,
			4,
			Buffer.concat([
				tiles.subarray(0, 4),
				tiles.subarray(4),
				literalStream(table, 1),
			]),
		);
		const layout = layoutOf(file);
		expect(layout.bitsPerPixel).toBe(32);
		const pixels = decodeG00Image(file, layout).pixels;
		const stride = 12;
		expect(pixels.subarray(2 * stride + 4, 2 * stride + 12)).toEqual(
			Buffer.from([0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17]),
		);
		expect(pixels.subarray(3 * stride + 4, 3 * stride + 12)).toEqual(
			Buffer.from([0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f]),
		);
		expect(pixels.subarray(0, 2 * stride + 4)).toEqual(
			Buffer.alloc(2 * stride + 4, 0x00),
		);
	});

	it("lists the picture as one bitmap and reports what it holds", async () => {
		const values = new Array<number>(12).fill(7);
		const file = g00File(0, 4, 1, literalStream(Buffer.from(values), 3));
		await expectArchive({
			format: realliveG00ImageFormat,
			archive: file,
			sourcePath: "face.g00",
			entries: [{ path: "face.bmp", size: file.length }],
			metadata: {
				image: "bmp",
				width: 4,
				height: 1,
				bitsPerPixel: 24,
				type: 0,
			},
		});
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = g00File(
			0,
			2,
			2,
			literalStream(Buffer.from(new Array<number>(18).fill(3)), 3),
		);
		const withByte = (offset: number, value: number): Buffer => {
			const copy = Buffer.from(good);
			copy[offset] = value;
			return copy;
		};
		const withWord = (offset: number, value: number, width: 2 | 4): Buffer => {
			const copy = Buffer.from(good);
			if (2 === width) copy.writeUInt16LE(value, offset);
			else copy.writeUInt32LE(value, offset);
			return copy;
		};
		// A picture of four gigabytes worth of pixels is more than this project will hold.
		const tooLargeHeader = Buffer.from(good);
		tooLargeHeader.writeUInt16LE(0x8000, 1);
		tooLargeHeader.writeUInt16LE(0x8000, 3);
		const tiled = g00File(2, 2, 2, Buffer.from([1, 0, 0, 0]));
		expect(
			await realliveG00ImageFormat.detect(new BufferByteSource(good), "a.g00"),
		).toBe(true);
		for (const candidate of [
			withByte(0, 3),
			withWord(1, 0, 2),
			withWord(1, 0x8001, 2),
			withWord(3, 0, 2),
			// A stored picture whose length does not reach to the end of the file.
			withWord(5, 4, 4),
			// A tiled picture with no tiles, and one with more than the four thousand it allows.
			g00File(2, 2, 2, Buffer.from([0, 0, 0, 0])),
			g00File(2, 2, 2, Buffer.from([1, 0x10, 0, 0])),
			// A picture too large to hold, and a file too short to hold a header.
			tooLargeHeader,
			quiet(1),
		]) {
			expect(
				await realliveG00ImageFormat.detect(
					new BufferByteSource(candidate),
					"a.g00",
				),
			).toBe(false);
		}
		expect(
			await realliveG00ImageFormat.detect(new BufferByteSource(tiled), "a.g00"),
		).toBe(true);
	});

	it("refuses a stream that does not unfold to the picture it declares", () => {
		// The copy asks for six bytes where only four are left of the picture.
		const short = g00File(
			0,
			2,
			1,
			packedStream(8, [1, 0], Buffer.from([1, 2, 3, 4, 5, 6, 0x00, 0x30])),
		);
		expect(() => decodeG00Image(short, layoutOf(short))).toThrow(GarbroError);
		// An indexed picture whose palette names no colour at all.
		const noColours = g00File(
			1,
			1,
			1,
			literalStream(Buffer.from([0, 0, 9]), 1),
		);
		expect(() => decodeG00Image(noColours, layoutOf(noColours))).toThrow(
			GarbroError,
		);
		// A tiled picture whose table names another number of tiles than the header does.
		const mismatch = g00File(
			2,
			2,
			2,
			Buffer.concat([
				Buffer.from([2, 0, 0, 0]),
				Buffer.alloc(0x18, 0),
				literalStream(Buffer.from([1, 0, 0, 0]), 1),
			]),
		);
		expect(() => decodeG00Image(mismatch, layoutOf(mismatch))).toThrow(
			GarbroError,
		);
		// A tiled picture whose only tile is empty.
		const empty = g00File(
			2,
			2,
			2,
			Buffer.concat([
				Buffer.from([1, 0, 0, 0]),
				Buffer.alloc(0x18, 0),
				literalStream(Buffer.from([1, 0, 0, 0, 0, 0, 0, 0]), 1),
			]),
		);
		expect(() => decodeG00Image(empty, layoutOf(empty))).toThrow(GarbroError);
	});
});

function quiet(length: number): Buffer {
	return Buffer.alloc(length);
}
