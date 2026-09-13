import { BufferByteSource } from "@garbro-mcp/core";
import { rmtImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("RMT ", "ascii");
const HEADER_SIZE = 0x14;
const BMP_HEADER_SIZE = 54;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

function buildRmt(options: {
	width: number;
	height: number;
	stream: Buffer;
	offsetX?: number;
	offsetY?: number;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeInt32LE(options.offsetX ?? 0, 4);
	header.writeInt32LE(options.offsetY ?? 0, 8);
	header.writeUInt32LE(options.width, 0x0c);
	header.writeUInt32LE(options.height, 0x10);
	return Buffer.concat([header, options.stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await rmtImageFormat.open(sourceOf(stored), "CG01.RMT");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ai5 rmt image", () => {
	it("declares the RMT signature and no extension", () => {
		expect(rmtImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("RMT ");
		expect(rmtImageFormat.descriptor.extensions).toEqual([]);
	});

	it("adds the differences along each row and then down the rows", async () => {
		// Two by two pixels. Within each row every pixel holds what to add to the one before it, and then
		// every row what to add to the row above; both sums are taken a byte at a time and hand derived here:
		// row one starts as 1 2 3 4 | 5 6 7 8 and becomes 1 2 3 4 | 6 8 10 12, and the second row starts as
		// 9 10 11 12 | 13 14 15 16 and ends as 10 12 14 16 | 19 22 25 28.
		const deltas = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const stored = buildRmt({
			width: 2,
			height: 2,
			stream: lzssLiterals(deltas),
		});
		const source = sourceOf(stored);
		expect(await rmtImageFormat.detect(source, "CG01.RMT")).toBe(true);
		const archive = await rmtImageFormat.open(source, "CG01.RMT");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
		// `CreateFlipped`, so the rows are stored bottom up and the height is positive.
		expect(output.readInt32LE(22)).toBe(2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([1, 2, 3, 4, 6, 8, 10, 12, 10, 12, 14, 16, 19, 22, 25, 28]),
		);
	});

	it("decodes a match through the shared lzss codec", async () => {
		// One pixel. Control bits are taken from the low end, so `03` means literal, literal, match; the match
		// token `EE F0` names frame offset 0xFEE with a length of three, which is where the first literal
		// landed, and the output stops as soon as the fourth byte is written.
		const stream = Buffer.concat([
			Buffer.from([0x03, 0x11, 0x22]),
			Buffer.from([0xee, 0xf0]),
		]);
		const stored = buildRmt({ width: 1, height: 1, stream });
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([0x11, 0x22, 0x11, 0x22]),
		);
	});

	it("leaves the rest of the image zero when the stream runs out", async () => {
		// One pixel of differences is stored for a two by two image, so three quarters of the buffer is zero
		// before the sums are taken, and the sums then repeat the stored pixel in every direction.
		const stored = buildRmt({
			width: 2,
			height: 2,
			stream: lzssLiterals(Buffer.from([0x11, 0x22, 0x33, 0x44])),
		});
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x44, 0x11, 0x22, 0x33, 0x44, 0x11, 0x22, 0x33, 0x44,
				0x11, 0x22, 0x33, 0x44,
			]),
		);
	});

	it("carries the two position words into the metadata", async () => {
		const deltas = Buffer.alloc(16, 0x01);
		const stored = buildRmt({
			width: 2,
			height: 2,
			stream: lzssLiterals(deltas),
			offsetX: -12,
			offsetY: 34,
		});
		const archive = await rmtImageFormat.open(sourceOf(stored), "CG01.RMT");
		try {
			expect(archive.metadata).toMatchObject({ offsetX: -12, offsetY: 34 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				offsetX: -12,
				offsetY: 34,
			});
		} finally {
			await archive.close();
		}
	});

	it("wraps the sums at a byte", async () => {
		// Two pixels in one row: 0xF0 then 0x20 adds to 0x110, which a byte keeps as 0x10.
		const stored = buildRmt({
			width: 2,
			height: 1,
			stream: lzssLiterals(
				Buffer.from([0xf0, 0x00, 0x00, 0x00, 0x20, 0, 0, 0]),
			),
		});
		const output = await extract(stored);
		const body = output.subarray(BMP_HEADER_SIZE);
		expect(body[0]).toBe(0xf0);
		expect(body[4]).toBe(0x10);
	});

	it("ignores input after the pixels it needs", async () => {
		// A complete image followed by junk that the codec never has to read.
		const deltas = Buffer.alloc(8, 0x05);
		const stream = Buffer.concat([
			lzssLiterals(deltas),
			Buffer.from([0xff, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99]),
		]);
		const stored = buildRmt({ width: 2, height: 1, stream });
		const output = await extract(stored);
		// Each row of one row is 5, 5, 5, 5 | 10, 10, 10, 10.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([5, 5, 5, 5, 10, 10, 10, 10]),
		);
	});

	it("declines a short header, a wrong signature and zero dimensions", async () => {
		const stream = lzssLiterals(Buffer.alloc(8, 0x01));
		const stored = buildRmt({ width: 2, height: 1, stream });
		expect(
			await rmtImageFormat.detect(sourceOf(stored.subarray(0, 19)), "CG01.RMT"),
		).toBe(false);
		const wrong = buildRmt({ width: 2, height: 1, stream });
		wrong[3] = 0x58;
		expect(await rmtImageFormat.detect(sourceOf(wrong), "CG01.RMT")).toBe(
			false,
		);
		const zero = buildRmt({ width: 2, height: 0, stream });
		expect(await rmtImageFormat.detect(sourceOf(zero), "CG01.RMT")).toBe(false);
	});
});
