import { BufferByteSource } from "@garbro-mcp/core";
import { bm1ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 5;
const FORBIDDEN_BITS = 0x42;

/** The reference's own packing: half of each byte carries one dimension, the halves alternating. */
function packHeader(width: number, height: number, first = 0x00): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header[0] = first;
	for (let index = 0; index < 4; index += 1) {
		const widthNibble = (width >> (4 * index)) & 0x0f;
		const heightNibble = (height >> (4 * index)) & 0x0f;
		header[index + 1] =
			(index & 1) === 0
				? ((heightNibble << 4) | widthNibble) & 0xff
				: ((widthNibble << 4) | heightNibble) & 0xff;
	}
	return header;
}

function strideOf(width: number): number {
	return (width * 3 + 3) & ~3;
}

/** A file is exactly the five byte header plus whole rows, padding included. */
function buildBm1(width: number, height: number, first = 0x00): Buffer {
	const stride = strideOf(width);
	const pixels = Buffer.alloc(stride * height, 0x00);
	for (let index = 0; index < pixels.length; index += 1) {
		pixels[index] = (index * 11 + 5) & 0xff;
	}
	return Buffer.concat([packHeader(width, height, first), pixels]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.1"): Promise<Buffer> {
	const archive = await bm1ImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("pisckiss encrypted bitmap", () => {
	it("declares the extension but no signature", () => {
		expect(bm1ImageFormat.detection?.signatures).toEqual([]);
		expect(bm1ImageFormat.descriptor.extensions).toEqual(["1"]);
		expect(bm1ImageFormat.descriptor.id).toBe("pisckiss-bm1-image");
	});

	it("unpacks both dimensions from four interleaved nibbles", async () => {
		// Hand written for a width of 0x0123 and a height of 0x4567: byte one starts both with its low half for
		// the width and its high half for the height, then the halves swap on every following byte.
		const header = packHeader(0x0123, 0x4567);
		expect([...header]).toEqual([0x00, 0x73, 0x26, 0x51, 0x04]);
		const file = Buffer.concat([
			header,
			Buffer.alloc(strideOf(0x0123) * 0x4567, 0x00),
		]);
		const archive = await bm1ImageFormat.open(sourceOf(file), "CG_01.1");
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 0x0123,
				height: 0x4567,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});

	it("refuses either of the two guarded bits in the first byte", async () => {
		// The first byte is rejected when either 0x40 or 0x02 is set; every other bit is ignored.
		for (const first of [0x40, 0x02, 0x42]) {
			const file = buildBm1(4, 3, first);
			expect(await bm1ImageFormat.detect(sourceOf(file), "A.1")).toBe(false);
		}
		for (const first of [0x00, 0x01, 0x80, 0xbd, 0xff & ~FORBIDDEN_BITS]) {
			const file = buildBm1(4, 3, first);
			expect(await bm1ImageFormat.detect(sourceOf(file), "A.1")).toBe(true);
		}
	});

	it("declines a bitmap, whose first byte is the guarded pair", async () => {
		// The letter B is 0x42 — exactly the two bits the format refuses — so a plain bitmap can never pass.
		expect("B".charCodeAt(0) & FORBIDDEN_BITS).toBe(FORBIDDEN_BITS);
		const bitmap = buildBm1(4, 3);
		bitmap[0] = 0x42;
		bitmap.write("BM", 0, "latin1");
		bitmap.writeUInt32LE(bitmap.length, 2);
		expect(await bm1ImageFormat.detect(sourceOf(bitmap), "A.bmp")).toBe(false);
	});

	it("requires the length to match exactly", async () => {
		const file = buildBm1(4, 3);
		expect(await bm1ImageFormat.detect(sourceOf(file), "A.1")).toBe(true);
		expect(
			await bm1ImageFormat.detect(
				sourceOf(file.subarray(0, file.length - 1)),
				"A.1",
			),
		).toBe(false);
		expect(
			await bm1ImageFormat.detect(
				sourceOf(Buffer.concat([file, Buffer.alloc(1)])),
				"A.1",
			),
		).toBe(false);
		expect(await bm1ImageFormat.detect(sourceOf(Buffer.alloc(4)), "A.1")).toBe(
			false,
		);
	});

	it("declines a zero dimension", async () => {
		for (const [width, height] of [
			[0, 4],
			[4, 0],
		] as const) {
			const file = Buffer.concat([
				packHeader(width, height),
				Buffer.alloc(strideOf(width) * height, 0x00),
			]);
			expect(await bm1ImageFormat.detect(sourceOf(file), "A.1")).toBe(false);
		}
	});

	it("passes the rows through with a positive height", async () => {
		const file = buildBm1(4, 3);
		const output = await extract(file);
		expect(output.readUInt16LE(0)).toBe(0x4d42);
		expect(output.readInt32LE(22)).toBe(3);
		expect(output.readUInt16LE(28)).toBe(24);
		// The rows are stored bottom up under a positive height, so nothing is reversed.
		expect(output.subarray(54)).toEqual(file.subarray(HEADER_SIZE));
	});

	it("keeps a padded stride intact", async () => {
		// Three pixels a row is nine bytes, padded to twelve; the stored padding is carried, not recomputed.
		const file = buildBm1(3, 2);
		expect(strideOf(3)).toBe(12);
		expect(file.length).toBe(HEADER_SIZE + 24);
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.subarray(54)).toEqual(file.subarray(HEADER_SIZE));
	});
});
