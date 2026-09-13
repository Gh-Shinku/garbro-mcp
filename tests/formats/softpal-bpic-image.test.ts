import { BufferByteSource } from "@garbro-mcp/core";
import { bpicImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("BPIC", "ascii");
const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;

function buildPixels(count: number, pixelSize: number): Buffer {
	const pixels: Buffer = Buffer.alloc(count * pixelSize);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = ((i + 1) * 37) & 0xff;
	return pixels;
}

function buildBpic(options: {
	width: number;
	height: number;
	pixelSize: number;
	pixels: Buffer;
	tail?: number;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(options.width, 4);
	header.writeUInt32LE(options.height, 8);
	header.writeInt32LE(options.pixelSize, 12);
	return Buffer.concat([
		header,
		options.pixels,
		Buffer.alloc(options.tail ?? 0, 0x5a),
	]);
}

/** Swaps the first and third byte of every pixel, the way the port should. */
function expectedSwap(pixels: Buffer, pixelSize: number): Buffer {
	const out = Buffer.from(pixels);
	for (let i = 2; i < out.length; i += pixelSize) {
		const t = out[i] ?? 0;
		out[i] = out[i - 2] ?? 0;
		out[i - 2] = t;
	}
	return out;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await bpicImageFormat.open(sourceOf(stored), "CG01.BPIC");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("softpal bpic image", () => {
	it("declares the BPIC signature and no extension", () => {
		expect(bpicImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(bpicImageFormat.descriptor.extensions).toEqual([]);
	});

	it("writes a 24 bit bitmap with the first and third channels swapped", async () => {
		// Two by one pixels: the stored triplets are red, green, blue and the bitmap gets blue, green, red.
		const pixels = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		const stored = buildBpic({ width: 2, height: 1, pixelSize: 3, pixels });
		const source = sourceOf(stored);
		expect(await bpicImageFormat.detect(source, "CG01.BPIC")).toBe(true);
		const archive = await bpicImageFormat.open(source, "CG01.BPIC");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 2,
				height: 1,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(24);
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([0x33, 0x22, 0x11, 0x66, 0x55, 0x44, 0x00, 0x00]),
		);
	});

	it("keeps the fourth byte of a 32 bit pixel in place", async () => {
		// The step is a whole pixel, so the walk visits the third byte of every pixel and never the fourth.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x11, 0x12, 0x13, 0x14,
		]);
		const stored = buildBpic({ width: 2, height: 1, pixelSize: 4, pixels });
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([0x03, 0x02, 0x01, 0x04, 0x13, 0x12, 0x11, 0x14]),
		);
	});

	it("leaves an eight bit image alone and writes a gray palette", async () => {
		const pixels = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const stored = buildBpic({ width: 2, height: 2, pixelSize: 1, pixels });
		const archive = await bpicImageFormat.open(sourceOf(stored), "CG01.BPIC");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerPixel: 8 });
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		// The ramp `writeBmp8` writes.
		for (const index of [0, 1, 200, 255]) {
			const at = BMP_HEADER_SIZE + index * 4;
			expect(output.subarray(at, at + 3)).toEqual(
				Buffer.from([index, index, index]),
			);
		}
		// Two pixel rows are padded to four bytes each and the samples are left as they were.
		expect(output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE)).toEqual(
			Buffer.from([0x01, 0x02, 0x00, 0x00, 0x03, 0x04, 0x00, 0x00]),
		);
	});

	it("ignores bytes past the pixels", async () => {
		// Two pixels of three bytes are read and nine bytes of the trailing junk are not.
		const pixels = buildPixels(2, 3);
		const stored = buildBpic({
			width: 2,
			height: 1,
			pixelSize: 3,
			pixels,
			tail: 9,
		});
		const output = await extract(stored);
		// The exact fill leaves the trailing bytes unread, so they reach no bitmap.
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.concat([expectedSwap(pixels, 3), Buffer.alloc(2)]),
		);
	});

	it("lists a short payload but fails to extract it", async () => {
		// Four pixels of three bytes are needed but only two are stored.
		const stored = buildBpic({
			width: 2,
			height: 2,
			pixelSize: 3,
			pixels: buildPixels(2, 3),
		});
		const source = sourceOf(stored);
		expect(await bpicImageFormat.detect(source, "CG01.BPIC")).toBe(true);
		const archive = await bpicImageFormat.open(source, "CG01.BPIC");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines a pixel size the reference does not accept", async () => {
		for (const pixelSize of [0, 2, 5]) {
			const stored = buildBpic({
				width: 1,
				height: 1,
				pixelSize,
				pixels: buildPixels(1, Math.max(pixelSize, 1)),
			});
			expect(await bpicImageFormat.detect(sourceOf(stored), "CG01.BPIC")).toBe(
				false,
			);
		}
	});

	it("declines a short header, a wrong signature and zero dimensions", async () => {
		const pixels = buildPixels(3, 3);
		const stored = buildBpic({ width: 1, height: 1, pixelSize: 3, pixels });
		expect(
			await bpicImageFormat.detect(
				sourceOf(stored.subarray(0, 15)),
				"CG01.BPIC",
			),
		).toBe(false);
		const wrong = buildBpic({ width: 1, height: 1, pixelSize: 3, pixels });
		wrong[1] = 0x58;
		expect(await bpicImageFormat.detect(sourceOf(wrong), "CG01.BPIC")).toBe(
			false,
		);
		const zero = buildBpic({ width: 0, height: 1, pixelSize: 3, pixels });
		expect(await bpicImageFormat.detect(sourceOf(zero), "CG01.BPIC")).toBe(
			false,
		);
	});

	it("reports the depth of every accepted pixel size", async () => {
		const cases: Array<[number, number]> = [
			[1, 8],
			[3, 24],
			[4, 32],
		];
		for (const [pixelSize, bits] of cases) {
			const stored = buildBpic({
				width: 1,
				height: 1,
				pixelSize,
				pixels: buildPixels(1, pixelSize),
			});
			const archive = await bpicImageFormat.open(sourceOf(stored), "CG01.BPIC");
			try {
				expect(archive.entries[0]?.metadata).toMatchObject({
					bitsPerPixel: bits,
				});
			} finally {
				await archive.close();
			}
		}
	});
});
