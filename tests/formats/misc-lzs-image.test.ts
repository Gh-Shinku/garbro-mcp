import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decompressLzs,
	miscLzsImageFormat,
	readLzsLayout,
} from "../../packages/formats/src/misc/lzs-image.js";
import { writeBmp24 } from "../../packages/formats/src/shared/bmp.js";

const HEADER_SIZE = 0x10;
const PLAIN_BITMAP_OFFSET = 0x1c;
const UNPACKED_BITMAP_OFFSET = 12;
const DATA_OFFSET = 0x36;

/** The bytes of a stream of the format, a group of eight control bits and then the bytes they stand for. */
function encodeLiterals(content: Buffer): Buffer {
	const out: number[] = [];
	for (let at = 0; at < content.length; at += 8) {
		const run = content.subarray(at, at + 8);
		out.push((0xff << (8 - run.length)) & 0xff);
		for (const byte of run) out.push(byte);
	}
	return Buffer.from(out);
}

interface FileParts {
	/** The bitmap the picture stands for, which a compressed file keeps behind a stream. */
	bitmap: Buffer;
	/** The bytes the stream unfolds to before the bitmap, which are skipped. */
	head?: Buffer;
	compressed?: boolean;
	/** A length other than the one the stream unfolds to. */
	unpackedSize?: number;
	/** The stream itself, for the files a fixture writes by hand. */
	stream?: Buffer;
}

/** A whole file: the header and either the bitmap or the stream that unfolds to it. */
function lzsFile(parts: FileParts): Buffer {
	const head: Buffer = parts.head ?? Buffer.alloc(UNPACKED_BITMAP_OFFSET, 0x00);
	const unfolded = Buffer.concat([head, parts.bitmap]);
	const compressed = parts.compressed ?? true;
	const size = compressed
		? (parts.unpackedSize ?? unfolded.length)
		: (parts.unpackedSize ?? parts.bitmap.length);
	const header: Buffer = Buffer.alloc(
		compressed ? HEADER_SIZE : PLAIN_BITMAP_OFFSET,
		0x00,
	);
	header.write("LZSS", 0, "latin1");
	header.writeInt32LE(size, 8);
	header[12] = compressed ? 1 : 0;
	if (compressed) {
		return Buffer.concat([header, parts.stream ?? encodeLiterals(unfolded)]);
	}
	return Buffer.concat([header, parts.bitmap]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.lzs"): Promise<Buffer> {
	const handle = await miscLzsImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of three bytes to the pixel, row by row. */
function pixelRows(bitmap: Buffer, width: number, height: number): string[] {
	const stride = (width * 3 + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					DATA_OFFSET + row * stride,
					DATA_OFFSET + row * stride + width * 3,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("LZSS-compressed bitmap", () => {
	it("finds a picture by its four bytes", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), false);
		expect(
			await miscLzsImageFormat.detect(sourceOf(lzsFile({ bitmap })), "cg.lzs"),
		).toBe(true);
		expect(
			await miscLzsImageFormat.detect(
				sourceOf(lzsFile({ bitmap, compressed: false })),
				"cg.lzs",
			),
		).toBe(true);
		expect(readLzsLayout(lzsFile({ bitmap }))).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			compressed: true,
		});
		// A header that is not all there, or four bytes that are not the ones the reference declares.
		expect(readLzsLayout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
		const odd = lzsFile({ bitmap });
		odd.write("LZST", 0, "latin1");
		expect(readLzsLayout(odd)).toBeUndefined();
		// A stream that does not unfold to a bitmap is turned away as well.
		const notBitmap = lzsFile({
			bitmap: Buffer.alloc(0x40, 0x41),
			stream: encodeLiterals(Buffer.alloc(0x50, 0x41)),
		});
		expect(readLzsLayout(notBitmap)).toBeUndefined();
	});

	it("reports the measurements of the bitmap behind the stream", async () => {
		const bitmap = writeBmp24(3, 2, Buffer.alloc(18, 0x22), false);
		const handle = await miscLzsImageFormat.open(
			sourceOf(lzsFile({ bitmap })),
			"dir/cg.lzs",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 3,
			height: 2,
			bitsPerPixel: 24,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
			width: 3,
			height: 2,
		});
	});

	it("unfolds the bitmap of a picture that stands behind a stream", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const bitmap = writeBmp24(2, 2, pixels, false);
		const out = await extract(lzsFile({ bitmap }));
		expect(pixelRows(out, 2, 2)).toEqual(["010203040506", "0708090a0b0c"]);
	});

	it("reads the bitmap of a picture that stands in the file as it is", async () => {
		const pixels = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		const bitmap = writeBmp24(2, 1, pixels, false);
		const data = lzsFile({ bitmap, compressed: false });
		expect(readLzsLayout(data)?.width).toBe(2);
		const out = await extract(data);
		expect(pixelRows(out, 2, 1)).toEqual(["112233445566"]);
	});

	it("copies a run out of the bytes the stream has just unfolded", () => {
		// Three bytes that stand in the stream, then a control bit of nothing and a word that names a place of
		// three and a count of three: the three bytes behind are written again.
		const content = Buffer.from([0x41, 0x42, 0x43, 0x41, 0x42, 0x43]);
		const stream = Buffer.concat([
			Buffer.from([0xe0]),
			content.subarray(0, 3),
			Buffer.from([0x30, 0x00]),
		]);
		expect(decompressLzs(stream, content.length).toString("hex")).toBe(
			content.toString("hex"),
		);
	});

	it("reads a run of bytes that stand in the stream themselves", () => {
		// A control bit of nothing and a word of nothing: sixteen bytes follow the word in the stream.
		const body = Buffer.alloc(16, 0x5a);
		const stream = Buffer.concat([Buffer.from([0x00, 0x00, 0x00]), body]);
		expect(decompressLzs(stream, 16).toString("hex")).toBe(
			body.toString("hex"),
		);
	});

	it("reads a long run of either kind through the byte behind its count", () => {
		// A count of fifteen and a byte of two stands for a run of thirty three bytes of the stream itself.
		const body = Buffer.alloc(33, 0x7e);
		const stream = Buffer.concat([Buffer.from([0x00, 0x0f, 0x00, 0x02]), body]);
		expect(decompressLzs(stream, 33).toString("hex")).toBe(
			body.toString("hex"),
		);
		// A count of fifteen and a byte of nothing stands for a copied run of eighteen bytes, taken from the
		// three bytes the stream has just unfolded, so the run repeats them over and over.
		const copied = Buffer.concat([
			Buffer.from([0xe0]),
			Buffer.from([0x41, 0x42, 0x43]),
			Buffer.from([0x3f, 0x00, 0x00]),
		]);
		expect(decompressLzs(copied, 21).toString("hex")).toBe("414243".repeat(7));
	});

	it("refuses a stream that runs out inside the picture", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), false);
		const data = lzsFile({ bitmap, stream: Buffer.from([0xf0, 1, 2]) });
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"LZSS picture is cut short of its stream",
		);
	});

	it("refuses a run that copies from before the start of the picture", () => {
		// A control bit of nothing then a word that names a place of one where the picture stands at nothing.
		const stream = Buffer.from([0x00, 0x10, 0x00]);
		expect(() => decompressLzs(stream, 8)).toThrow(
			"LZSS picture copies from before its start",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const bitmap = writeBmp24(2, 1, Buffer.from([1, 2, 3, 4, 5, 6]), false);
		const data = lzsFile({ bitmap, unpackedSize: 0x20000000 });
		expect(await miscLzsImageFormat.detect(sourceOf(data), "cg.lzs")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("reads the bytes of a stream on its own", () => {
		const content = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]);
		const out = decompressLzs(encodeLiterals(content), content.length);
		expect(out.toString("hex")).toBe(content.toString("hex"));
		expect(UNPACKED_BITMAP_OFFSET).toBe(12);
	});
});
