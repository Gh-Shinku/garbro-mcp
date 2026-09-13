import { BufferByteSource } from "@garbro-mcp/core";
import { mbpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;
const DATA_OFFSET = BMP_HEADER_SIZE + 12;
const WIDTH = 3;
const HEIGHT = 2;

function buildMbp(width = WIDTH, height = HEIGHT): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	const pixels: Buffer = Buffer.alloc(width * height * 2);
	for (let i = 0; i < pixels.length; i += 2) {
		// Distinct 555 values so a repacked pixel would show up.
		pixels.writeUInt16LE(0x4210 + i * 0x21, i);
	}
	return Buffer.concat([header, pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("hmp mbp image", () => {
	it("declares no signature, since the reference has none", () => {
		expect(mbpImageFormat.detection?.signatures).toEqual([]);
	});

	it("writes a 555 bitmap with bitfields", async () => {
		const stored = buildMbp();
		const source = sourceOf(stored);
		expect(await mbpImageFormat.detect(source, "FACE.MBP")).toBe(true);
		const archive = await mbpImageFormat.open(source, "FACE.MBP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["FACE.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: WIDTH,
				height: HEIGHT,
				bitsPerPixel: 15,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: WIDTH,
				height: HEIGHT,
				pixelFormat: "bgr555",
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(28)).toBe(16);
			// `BI_BITFIELDS`, with the masks right after the DIB header.
			expect(output.readUInt32LE(30)).toBe(3);
			expect(output.readUInt32LE(10)).toBe(DATA_OFFSET);
			expect(output.readUInt32LE(54)).toBe(0x7c00);
			expect(output.readUInt32LE(58)).toBe(0x03e0);
			expect(output.readUInt32LE(62)).toBe(0x001f);
			// Top down rows, as `ImageData.Create` produces.
			expect(output.readInt32LE(22)).toBe(-HEIGHT);
			// An odd width pads each row to four bytes: six pixel bytes plus two.
			const stride = (WIDTH * 2 + 3) & ~3;
			expect(stride).toBe(8);
			const body = output.subarray(DATA_OFFSET);
			expect(body.length).toBe(stride * HEIGHT);
			expect(body.subarray(0, WIDTH * 2)).toEqual(
				stored.subarray(HEADER_SIZE, HEADER_SIZE + WIDTH * 2),
			);
			expect(body[WIDTH * 2]).toBe(0);
			expect(body[WIDTH * 2 + 1]).toBe(0);
			// The second row follows the padding.
			expect(body.subarray(stride, stride + WIDTH * 2)).toEqual(
				stored.subarray(HEADER_SIZE + WIDTH * 2, HEADER_SIZE + WIDTH * 4),
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose length does not match its dimensions", async () => {
		const stored = buildMbp();
		expect(await mbpImageFormat.detect(sourceOf(stored), "FACE.MBP")).toBe(
			true,
		);
		// One byte short in either direction is enough to fail the length test.
		expect(
			await mbpImageFormat.detect(
				sourceOf(stored.subarray(0, stored.length - 1)),
				"FACE.MBP",
			),
		).toBe(false);
		const padded = Buffer.concat([stored, Buffer.alloc(1)]);
		expect(await mbpImageFormat.detect(sourceOf(padded), "FACE.MBP")).toBe(
			false,
		);
	});

	it("declines a file without the MBP extension", async () => {
		const stored = buildMbp();
		expect(await mbpImageFormat.detect(sourceOf(stored), "FACE.BMP")).toBe(
			false,
		);
		expect(await mbpImageFormat.detect(sourceOf(stored), "FACE")).toBe(false);
		// The extension is compared without regard to case.
		expect(await mbpImageFormat.detect(sourceOf(stored), "face.mbp")).toBe(
			true,
		);
	});

	it("declines zero dimensions", async () => {
		expect(
			await mbpImageFormat.detect(sourceOf(buildMbp(0, 0)), "FACE.MBP"),
		).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await mbpImageFormat.detect(sourceOf(Buffer.alloc(4)), "FACE.MBP"),
		).toBe(false);
	});
});
