import { BufferByteSource } from "@garbro-mcp/core";
import { surImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x45, 0x53, 0x55, 0x52]);
const HEADER_SIZE = 0x10;
const PIXEL_OFFSET = 0x20;
const BMP_HEADER_SIZE = 54;
/** The marker the fixture writes into the sixteen bytes the reference never reads. */
const GAP_MARKER = 0xab;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

function buildPixels(size: number): Buffer {
	const pixels: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 61 + 3) & 0xff;
	return pixels;
}

function buildSur(options: {
	width: number;
	height: number;
	stream: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(options.width, 8);
	header.writeUInt32LE(options.height, 12);
	return Buffer.concat([
		header,
		Buffer.alloc(PIXEL_OFFSET - HEADER_SIZE, GAP_MARKER),
		options.stream,
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await surImageFormat.open(sourceOf(stored), "CG01.SUR");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("tamasoft sur image", () => {
	it("declares the ESUR signature and no extension", () => {
		expect(surImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("ESUR");
		expect(surImageFormat.descriptor.extensions).toEqual([]);
	});

	it("writes a top down 32 bit bitmap", async () => {
		// Two by two pixels is sixteen bytes.
		const pixels = buildPixels(16);
		const stored = buildSur({
			width: 2,
			height: 2,
			stream: lzssLiterals(pixels),
		});
		const source = sourceOf(stored);
		expect(await surImageFormat.detect(source, "CG01.SUR")).toBe(true);
		const archive = await surImageFormat.open(source, "CG01.SUR");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "sur-lzss",
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
		// `ImageData.Create` keeps rows top down, which a bitmap records with a negative height.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("reads a match offset with the low byte holding the high bits", async () => {
		// Four literals land at frame offsets 0xFEE to 0xFF1, then a match reads from 0xFF0.
		//
		// The token below is `FF 00`. This variant computes `(low << 4) | (high >> 4)`, which is 0xFF0 and
		// therefore the third literal, 0x33. GARbro's usual encoding would compute `((high & 0xF0) << 4) | low`
		// from the same two bytes, which is 0x0FF — a frame position nothing has written, so a port that used
		// the shared codec would produce zeros here. The matched bytes are written back into the frame as they
		// are copied, so the third one is the first byte the match itself emitted.
		const control = 0x2f; // bits 0 to 3 literals, bit 4 a match, bit 5 the last literal.
		const stream = Buffer.concat([
			Buffer.from([control, 0x11, 0x22, 0x33, 0x44]),
			Buffer.from([0xff, 0x00]),
			Buffer.from([0x55]),
		]);
		const stored = buildSur({ width: 2, height: 1, stream });
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x33, 0x44, 0x33, 0x55]),
		);
	});

	it("ignores the sixteen bytes between the header and the stream", async () => {
		const pixels = buildPixels(8);
		const stored = buildSur({
			width: 2,
			height: 1,
			stream: lzssLiterals(pixels),
		});
		expect(stored.subarray(HEADER_SIZE, PIXEL_OFFSET)).toEqual(
			Buffer.alloc(16, GAP_MARKER),
		);
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("stops as soon as it has enough pixels", async () => {
		// Everything after the first eight decoded bytes belongs to no image and is not read.
		const pixels = buildPixels(8);
		const stream = Buffer.concat([
			lzssLiterals(pixels),
			Buffer.from([0xff, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99, 0x99]),
		]);
		const stored = buildSur({ width: 2, height: 1, stream });
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(pixels);
	});

	it("lists a truncated stream but fails to extract it", async () => {
		const pixels = buildPixels(16);
		const stored = buildSur({
			width: 2,
			height: 2,
			stream: lzssLiterals(pixels).subarray(0, 8),
		});
		const source = sourceOf(stored);
		expect(await surImageFormat.detect(source, "CG01.SUR")).toBe(true);
		const archive = await surImageFormat.open(source, "CG01.SUR");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines zero dimensions and a short header", async () => {
		expect(
			await surImageFormat.detect(
				sourceOf(buildSur({ width: 0, height: 2, stream: Buffer.alloc(0) })),
				"CG01.SUR",
			),
		).toBe(false);
		expect(
			await surImageFormat.detect(
				sourceOf(
					buildSur({ width: 2, height: 2, stream: Buffer.alloc(0) }).subarray(
						0,
						15,
					),
				),
				"CG01.SUR",
			),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const stored = buildSur({
			width: 2,
			height: 1,
			stream: lzssLiterals(buildPixels(8)),
		});
		stored[3] = 0x53;
		expect(await surImageFormat.detect(sourceOf(stored), "CG01.SUR")).toBe(
			false,
		);
	});
});
