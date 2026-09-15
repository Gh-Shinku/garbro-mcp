import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	qsoftBpeImageFormat,
	decompressBpe,
	readBpeFields,
} from "../../packages/formats/src/qsoft/bpe-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const STREAM_OFFSET = 4;
const PREFIX_SIZE = 0x36;

/** A whole table of two hundred and fifty six tokens, laid out one control byte for all of them. */
function table(pairs: Map<number, [number, number]>): Buffer {
	// A control byte reaches a hundred and twenty eight tokens at most, since anything above `0x7F` steps
	// over tokens rather than laying them out, so the whole table takes two of them.
	const bytes: number[] = [];
	for (let group = 0; group < 2; group += 1) {
		bytes.push(0x7f);
		for (let index = 0; index < 128; index += 1) {
			const token = group * 128 + index;
			const pair = pairs.get(token);
			if (pair) bytes.push(pair[0], pair[1]);
			else bytes.push(token);
		}
	}
	return Buffer.from(bytes);
}

/** A chunk of the stream: the table, the count of the tokens in it and the tokens themselves. */
function chunk(pairs: Map<number, [number, number]>, tokens: number[]): Buffer {
	const size: Buffer = Buffer.alloc(2, 0x00);
	size.writeUInt16BE(tokens.length, 0);
	return Buffer.concat([table(pairs), size, Buffer.from(tokens)]);
}

/** A whole file: the length the stream unfolds to and the chunks behind it. */
function bpeFile(unpackedSize: number, chunks: Buffer[]): Buffer {
	const head: Buffer = Buffer.alloc(STREAM_OFFSET, 0x00);
	head.writeUInt32LE(unpackedSize, 0);
	return Buffer.concat([head, ...chunks]);
}

/** A picture that unfolds to the bytes given, one token to a byte. */
function literalFile(bitmap: Buffer): Buffer {
	const tokens: number[] = [];
	for (const byte of bitmap) tokens.push(byte);
	return bpeFile(bitmap.length, [chunk(new Map(), tokens)]);
}

/** The picture behind the stream of a file, three bytes to the pixel. */
function innerBitmap(width: number, height: number, pixels: Buffer): Buffer {
	return writeBmp24(width, height, pixels, false);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.bpe"): Promise<Buffer> {
	const handle = await qsoftBpeImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of three bytes to the pixel, taken from behind its header. */
function pixelBytes(
	bitmap: Buffer,
	width: number,
	height: number,
	offset: number,
): string {
	const stride = (width * 3 + 3) & ~3;
	const parts: string[] = [];
	for (let row = 0; row < height; row += 1) {
		parts.push(
			bitmap
				.subarray(offset + row * stride, offset + row * stride + width * 3)
				.toString("hex"),
		);
	}
	return parts.join("");
}

describe("Qsoft picture format", () => {
	it("finds a picture only where it is named for one", async () => {
		const inner = innerBitmap(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const data = literalFile(inner);
		expect(await qsoftBpeImageFormat.detect(sourceOf(data), "cg.bpe")).toBe(
			true,
		);
		expect(await qsoftBpeImageFormat.detect(sourceOf(data), "dir/cg.BPE")).toBe(
			true,
		);
		// The reference reads the format only out of files named `.bpe`, since it declares no signature.
		expect(await qsoftBpeImageFormat.detect(sourceOf(data), "cg.bmp")).toBe(
			false,
		);
		// The four bytes have to say the picture is at least as long as a bitmap header.
		const short = bpeFile(0x10, [chunk(new Map(), [0x42, 0x4d])]);
		expect(readBpeFields(short)).toBeUndefined();
		// A stream that unfolds to something that is not a bitmap is turned away.
		expect(
			readBpeFields(literalFile(Buffer.alloc(PREFIX_SIZE, 0x00))),
		).toBeUndefined();
		expect(readBpeFields(Buffer.alloc(4, 0x00))).toBeUndefined();
	});

	it("reports the measurements of the bitmap behind the stream", async () => {
		const inner = innerBitmap(3, 2, Buffer.alloc(18, 0x22));
		const handle = await qsoftBpeImageFormat.open(
			sourceOf(literalFile(inner)),
			"dir/cg.bpe",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "bpe",
			width: 3,
			height: 2,
		});
	});

	it("unfolds a picture the tokens of which stand for themselves", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const inner = innerBitmap(2, 2, pixels);
		const bitmap = await extract(literalFile(inner));
		expect(pixelBytes(bitmap, 2, 2, 54)).toBe("0102030405060708090a0b0c");
	});

	it("unfolds a token that stands for two others", async () => {
		// A table where the second to last token stands for the tokens four and five, which stand for
		// themselves: one token in the stream puts the two bytes four and five into the picture.
		const pairs = new Map<number, [number, number]>([[0xfe, [4, 5]]]);
		const pixels = Buffer.from([4, 5, 4, 5, 0x11, 0x22, 4, 5, 4, 5, 0x11, 9]);
		const inner = innerBitmap(4, 1, pixels);
		// The stream stands the header of the bitmap in the stream itself; the picture behind it, which is here
		// the twelve bytes above, is written out of the one token that stands for two bytes.
		const folded = bpeFile(inner.length, [
			chunk(pairs, [
				...inner.subarray(0, 54),
				0xfe,
				0xfe,
				0x11,
				0x22,
				0xfe,
				0xfe,
				0x11,
				9,
			]),
		]);
		expect(pixelBytes(await extract(folded), 4, 1, 54)).toBe(
			Buffer.from(pixels).toString("hex"),
		);
	});

	it("unfolds a token that stands for a run of bytes through the tokens behind it", async () => {
		// The second to last token stands for the token before it and the byte six, and that token in turn for
		// the bytes four and five, so one token in the stream puts three bytes into the picture.
		const pairs = new Map<number, [number, number]>([
			[0xfe, [0xfd, 6]],
			[0xfd, [4, 5]],
		]);
		const pixels = Buffer.from([4, 5, 6, 4, 5, 6, 4, 5, 6, 4, 5, 6]);
		const inner = innerBitmap(4, 1, pixels);
		const folded = bpeFile(inner.length, [
			chunk(pairs, [...inner.subarray(0, 54), 0xfe, 0xfe, 0xfe, 0xfe]),
		]);
		expect(pixelBytes(await extract(folded), 4, 1, 54)).toBe(
			Buffer.from(pixels).toString("hex"),
		);
	});

	it("takes the count of the chunk in the two bytes behind the table, highest byte first", () => {
		// The count says how many tokens stand in the stream, not how many bytes come out of them.
		const data = bpeFile(2, [chunk(new Map(), [0x41])]);
		const out = decompressBpe(data.subarray(STREAM_OFFSET), 2);
		expect(out.toString("hex")).toBe("4100");
	});

	it("leaves the rest of the picture as it stands where the stream runs out", () => {
		const data = bpeFile(4, [chunk(new Map(), [0x41, 0x42])]);
		const out = decompressBpe(data.subarray(STREAM_OFFSET), 4);
		expect(out.toString("hex")).toBe("41420000");
	});

	it("refuses a stream that runs out where a count is wanted", async () => {
		// The table is laid out in full and the file then ends, where the walk wants the count of the chunk.
		const inner = innerBitmap(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const folded = bpeFile(inner.length, [table(new Map())]);
		await expect(extract(folded)).rejects.toThrow(GarbroError);
		await expect(extract(folded)).rejects.toThrow(
			"QSoft picture is cut short of its stream",
		);
	});

	it("refuses a table that nests deeper than the stack of tokens", async () => {
		// Two tokens that stand for each other, so taking one of them up puts two more of them on the stack
		// and the pile grows until it runs out of room.
		const pairs = new Map<number, [number, number]>([
			[0xfe, [0xfd, 0xfd]],
			[0xfd, [0xfe, 0xfe]],
		]);
		const folded = bpeFile(PREFIX_SIZE, [chunk(pairs, [0xfe])]);
		await expect(extract(folded)).rejects.toThrow(
			"QSoft picture runs out of room for its tokens",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const inner = innerBitmap(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]));
		const folded = bpeFile(0x20000000, [
			chunk(new Map(), [...inner.subarray(0, 0x36)]),
		]);
		expect(await qsoftBpeImageFormat.detect(sourceOf(folded), "cg.bpe")).toBe(
			true,
		);
		await expect(extract(folded)).rejects.toThrow("is too large");
	});
});
