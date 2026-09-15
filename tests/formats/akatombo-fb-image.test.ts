import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	akatomboFbImageFormat,
	readFbLayout,
	unpackFb,
} from "../../packages/formats/src/akatombo/fb-image.js";

const HEADER_SIZE = 8;
const DATA_OFFSET = 0x36;

/** A stream of bits, highest bit first, written out a word of four bytes at a time from its highest bit down. */
class BitWriter {
	private readonly bits: number[] = [];

	push(bit: number): void {
		this.bits.push(bit & 1);
	}

	pushBits(count: number, value: number): void {
		for (let index = count - 1; index >= 0; index -= 1) {
			this.push((value >> index) & 1);
		}
	}

	/** The bits that stand at one before the value, then a nothing, which is how a count is written. */
	pushCount(count: number): void {
		for (let index = 0; index < count - 1; index += 1) {
			this.push(1);
		}
		this.push(0);
	}

	/** A difference of the value given, which is the byte the reader adds to the one before it. */
	pushDiff(byte: number): void {
		const value = byte < 0x80 ? 2 * (byte + 1) : 2 * (0x100 - byte) + 1;
		// The count says how many bits stand behind the one at the top of the value.
		const count = 31 - Math.clz32(value);
		this.pushCount(count);
		this.pushBits(count, value);
	}

	/** A pixel built from nothing, with the three differences of its colour. */
	pushPixel(blue: number, green: number, red: number): void {
		this.push(1);
		this.pushDiff(blue);
		this.pushDiff(green);
		this.pushDiff(red);
	}

	/** A pixel copied from one of the four pixels around it. */
	pushCopy(vertical: number, place: number, diffs: number[]): void {
		this.push(0);
		this.push(vertical);
		this.push(place);
		for (const diff of diffs) {
			this.pushDiff(diff);
		}
	}

	/** The bits as whole words of four bytes, big endian, with a word the picture does not reach left out. */
	toBuffer(): Buffer {
		const words = Math.ceil(this.bits.length / 32);
		const out: Buffer = Buffer.alloc(words * 4, 0x00);
		this.bits.forEach((bit, index) => {
			if (bit) {
				const at = index >> 3;
				out[at] = (out[at] ?? 0) | (0x80 >> (index & 7));
			}
		});
		return out;
	}

	/** How many bytes the bits take once written out. */
	byteLength(): number {
		return this.toBuffer().length;
	}
}

/** A whole file: the eight byte header and the stream behind it. */
function fbFile(width: number, height: number, payload: Buffer): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write("FB", 0, "latin1");
	head[2] = 0x18;
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	return Buffer.concat([head, payload]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.fb"): Promise<Buffer> {
	const handle = await akatomboFbImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of the bitmap, row by row, in the order the decoder built them. */
function pixelRows(bitmap: Buffer, width: number, height: number): string[] {
	const stride = width * 4;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(DATA_OFFSET + row * stride, DATA_OFFSET + (row + 1) * stride)
				.toString("hex"),
		);
	}
	return rows;
}

describe("Akatombo picture format", () => {
	it("finds a picture by its four bytes", async () => {
		const writer = new BitWriter();
		writer.pushPixel(1, 2, 3);
		const data = fbFile(1, 1, writer.toBuffer());
		expect(await akatomboFbImageFormat.detect(sourceOf(data), "cg.fb")).toBe(
			true,
		);
		expect(readFbLayout(data)).toEqual({ width: 1, height: 1 });
		// The header of a picture of no width or height, of no letters, or of no bytes at all is turned away.
		expect(readFbLayout(fbFile(0, 1, writer.toBuffer()))).toBeUndefined();
		expect(readFbLayout(fbFile(1, 0, writer.toBuffer()))).toBeUndefined();
		expect(readFbLayout(Buffer.alloc(HEADER_SIZE, 0x00))).toBeUndefined();
		expect(readFbLayout(Buffer.alloc(4, 0x00))).toBeUndefined();
	});

	it("reports the measurements and the depth it writes out", async () => {
		const writer = new BitWriter();
		writer.pushPixel(1, 2, 3);
		writer.pushPixel(4, 5, 6);
		const handle = await akatomboFbImageFormat.open(
			sourceOf(fbFile(2, 1, writer.toBuffer())),
			"dir/cg.fb",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 2,
			height: 1,
		});
	});

	it("writes a picture the rows of which stand the other way up", async () => {
		const writer = new BitWriter();
		writer.pushPixel(0x11, 0x22, 0x33);
		const bitmap = await extract(fbFile(1, 1, writer.toBuffer()));
		expect(bitmap.readUInt16LE(0x1c)).toBe(32);
		// A picture whose rows stand the other way up is written with a height above nothing, not below.
		expect(bitmap.readInt32LE(0x16)).toBe(1);
		expect(pixelRows(bitmap, 1, 1)).toEqual(["11223300"]);
	});

	it("builds a pixel out of the differences of its colour", async () => {
		const writer = new BitWriter();
		writer.pushPixel(10, 20, 30);
		const bitmap = await extract(fbFile(1, 1, writer.toBuffer()));
		expect(pixelRows(bitmap, 1, 1)).toEqual(["0a141e00"]);
	});

	it("adds the differences of a colour to those of the pixel before it", async () => {
		const writer = new BitWriter();
		writer.pushPixel(10, 20, 30);
		// The pixel to the left, with one, two and three put on its colours.
		writer.pushCopy(0, 0, [1, 2, 3]);
		const bitmap = await extract(fbFile(2, 1, writer.toBuffer()));
		expect(pixelRows(bitmap, 2, 1)).toEqual(["0a141e000b162100"]);
	});

	it("reads a difference below nothing as one taken away", async () => {
		const writer = new BitWriter();
		writer.pushPixel(10, 20, 30);
		// One taken off the blue, two off the green and one off the red.
		writer.pushCopy(0, 0, [0xff, 0xfe, 0xff]);
		const bitmap = await extract(fbFile(2, 1, writer.toBuffer()));
		expect(pixelRows(bitmap, 2, 1)).toEqual(["0a141e0009121d00"]);
	});

	it("takes a copy from the pixels around it", async () => {
		const rows = [
			// The top row of the picture: two pixels built from nothing.
			[
				["pixel", 0x10, 0x20, 0x30],
				["pixel", 0x40, 0x50, 0x60],
			],
			// The bottom row: the pixel above, then the one a row up and one along in the stream, which for the
			// last pixel of a row is the first pixel of the row it stands in rather than the one to its right.
			[
				["copy", 1, 0, [1, 1, 1]],
				["copy", 1, 1, [2, 2, 2]],
			],
		] as const;
		const writer = new BitWriter();
		for (const row of rows) {
			for (const step of row) {
				if ("pixel" === step[0]) writer.pushPixel(step[1], step[2], step[3]);
				else writer.pushCopy(step[1], step[2], [...step[3]]);
			}
		}
		const bitmap = await extract(fbFile(2, 2, writer.toBuffer()));
		// The top row, the pixel under its first one copied straight down, and the last pixel of the bottom row,
		// which the reference reads a row up and one along and so finds the first pixel of its own row.
		expect(pixelRows(bitmap, 2, 2)).toEqual([
			"1020300040506000",
			"1121310013233300",
		]);
	});

	it("takes a copy from the pixel up and to the left", async () => {
		const writer = new BitWriter();
		// Four pixels: the top row built from nothing, then the bottom row's second pixel from up and left.
		writer.pushPixel(0x80, 0x90, 0xa0);
		writer.pushPixel(0x40, 0x50, 0x60);
		writer.pushPixel(0x11, 0x21, 0x31);
		writer.pushCopy(0, 1, [3, 3, 3]);
		const bitmap = await extract(fbFile(2, 2, writer.toBuffer()));
		expect(pixelRows(bitmap, 2, 2)).toEqual([
			"8090a00040506000",
			"112131008393a300",
		]);
	});

	it("builds a pixel from nothing where a copy reaches outside the picture", async () => {
		const writer = new BitWriter();
		// A copy control at the very first pixel, where every place it could reach is outside the picture.
		writer.pushCopy(0, 1, [5, 6, 7]);
		const bitmap = await extract(fbFile(1, 1, writer.toBuffer()));
		expect(pixelRows(bitmap, 1, 1)).toEqual(["05060700"]);
	});

	it("reads the bits of a picture out of as many words as it needs", async () => {
		const writer = new BitWriter();
		for (let index = 0; index < 5; index += 1) {
			writer.pushPixel(index + 1, index + 2, index + 3);
		}
		// Five pixels take more than a word of thirty two bits.
		expect(writer.byteLength()).toBeGreaterThan(4);
		const bitmap = await extract(fbFile(5, 1, writer.toBuffer()));
		expect(pixelRows(bitmap, 5, 1)).toEqual([
			"0102030002030400030405000405060005060700",
		]);
	});

	it("refuses a picture the stream runs out inside", async () => {
		// A picture with no stream behind it at all has no word to start on.
		const empty = fbFile(1, 1, Buffer.alloc(0));
		await expect(extract(empty)).rejects.toThrow(GarbroError);
		await expect(extract(empty)).rejects.toThrow(
			"Akatombo picture is cut short of its stream",
		);
		// A picture of six pixels asks for more bits than the one word the stream holds.
		const writer = new BitWriter();
		writer.pushPixel(1, 2, 3);
		await expect(extract(fbFile(6, 1, writer.toBuffer()))).rejects.toThrow(
			"Akatombo picture is cut short of its stream",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const writer = new BitWriter();
		writer.pushPixel(1, 2, 3);
		const data = fbFile(0xffff, 0xffff, writer.toBuffer());
		expect(await akatomboFbImageFormat.detect(sourceOf(data), "cg.fb")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("walks the pixels of a picture of one row itself", () => {
		const writer = new BitWriter();
		writer.pushPixel(0x7f, 0x80, 0xff);
		const layout = readFbLayout(fbFile(1, 1, writer.toBuffer()));
		if (!layout) throw new Error("no layout");
		expect(
			unpackFb(fbFile(1, 1, writer.toBuffer()), layout).toString("hex"),
		).toBe("7f80ff00");
	});
});
