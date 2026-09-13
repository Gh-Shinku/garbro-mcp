import { BufferByteSource } from "@garbro-mcp/core";
import { thpImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 4;
const PALETTE_COLORS = 0x100;
const PALETTE_SIZE = PALETTE_COLORS * 3;
const PIXEL_OFFSET = HEADER_SIZE + PALETTE_SIZE;
const BMP_HEADER_SIZE = 54;

/** A palette whose first two entries are tell-tale triples; the reference declares it `Bgr`. */
function buildPalette(first = [5, 7, 11], second = [0x21, 0x22, 0x23]): Buffer {
	const palette: Buffer = Buffer.alloc(PALETTE_SIZE, 0x00);
	Buffer.from(first).copy(palette, 0);
	Buffer.from(second).copy(palette, 3);
	return palette;
}

function buildThp(options: {
	width: number;
	/** Written to the header, which the reference never reads. */
	secondWord?: number;
	pixels: Buffer;
	palette?: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt16LE(options.width, 0);
	header.writeUInt16LE(options.secondWord ?? options.width, 2);
	return Buffer.concat([
		header,
		options.palette ?? buildPalette(),
		options.pixels,
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.THP"): Promise<Buffer> {
	const archive = await thpImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The byte after the header and the palette. */
function body(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE + PALETTE_COLORS * 4);
}

describe("primesoft thp image", () => {
	it("registers no signature and no extension", () => {
		expect(thpImageFormat.detection?.signatures ?? []).toEqual([]);
		expect(thpImageFormat.descriptor.extensions).toEqual([]);
	});

	it("unpacks literals and runs into a bottom up bitmap", async () => {
		// A width of four means four rows of four. The stream is two literals, then `03 03 03` — the pixel,
		// its repeat and a count byte of three, which the reference turns into four copies — then ten more
		// literals, so the buffer is filled exactly. The run is the only place its pixel is written.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x03, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08, 0x09, 0x0a,
			0x0b, 0x0c, 0x0d,
		]);
		const stored = buildThp({ width: 4, pixels });
		const source = sourceOf(stored);
		expect(await thpImageFormat.detect(source, "IMAGE.THP")).toBe(true);
		const archive = await thpImageFormat.open(source, "IMAGE.THP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 4,
				height: 4,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({ width: 4, height: 4 });
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		// `CreateFlipped` is a bottom up bitmap, which a bitmap records as a positive height.
		expect(output.readInt32LE(22)).toBe(4);
		expect(output.readUInt32LE(46)).toBe(PALETTE_COLORS);
		// The palette is declared `Bgr`, so the stored triple is already in bitmap order.
		expect(output.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 4)).toEqual(
			Buffer.from([5, 7, 11, 0]),
		);
		expect(output.subarray(BMP_HEADER_SIZE + 4, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([0x21, 0x22, 0x23, 0x00]),
		);
		expect(body(output)).toEqual(
			Buffer.from([1, 2, 3, 3, 3, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13]),
		);
	});

	it("takes the height from the first word, as the reference does", async () => {
		// The second `ToUInt16` call also passes zero, so the height is the width and the second word is never
		// read. Nine pixels are decoded for a width of three whatever that word says.
		const stored = buildThp({
			width: 3,
			secondWord: 9,
			pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
		});
		const archive = await thpImageFormat.open(sourceOf(stored), "IMAGE.THP");
		try {
			expect(archive.metadata).toMatchObject({ width: 3, height: 3 });
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 3,
				height: 3,
			});
		} finally {
			await archive.close();
		}
		expect(await thpImageFormat.detect(sourceOf(stored), "IMAGE.THP")).toBe(
			true,
		);
	});

	it("writes the pixels contiguously, so rows drift into the padding", async () => {
		// The decoder fills its buffer without skipping anything, while the buffer is the padded stride times
		// the height: three rows of four for a width of three, of which only nine bytes are decoded. Row zero
		// therefore ends with the first pixel of row one, which is the drift.
		const stored = buildThp({
			width: 3,
			pixels: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9]),
		});
		const output = await extract(stored);
		expect(output.readInt32LE(34)).toBe(12);
		expect(body(output)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 0x00, 0x00, 0x00]),
		);
	});

	it("lets a run fill the padding as well", async () => {
		// Nine pixels announced: three literals and a run of nine writes twelve bytes, which is exactly the
		// buffer, so the padding ends up holding pixel values rather than zeros.
		const pixels = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x44, 0x08]);
		const stored = buildThp({ width: 3, pixels });
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44, 0x44,
			]),
		);
	});

	it("fails when a run passes the end of the buffer", async () => {
		// A longer run writes past twelve bytes, which the reference's unchecked store turns into an array
		// bounds exception.
		const pixels = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x44, 0x0c]);
		const overrun = buildThp({ width: 3, pixels });
		expect(overrun[PIXEL_OFFSET + 5]).toBe(0x0c);
		expect(await thpImageFormat.detect(sourceOf(overrun), "IMAGE.THP")).toBe(
			true,
		);
		const archive = await thpImageFormat.open(sourceOf(overrun), "IMAGE.THP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("fails when the stream ends before the image does", async () => {
		const stored = buildThp({ width: 4, pixels: Buffer.from([1, 2, 3]) });
		expect(await thpImageFormat.detect(sourceOf(stored), "IMAGE.THP")).toBe(
			true,
		);
		const archive = await thpImageFormat.open(sourceOf(stored), "IMAGE.THP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("fails when the palette is missing", async () => {
		// The reference reads the palette before it touches the pixels.
		const short = Buffer.concat([
			Buffer.alloc(HEADER_SIZE + 10, 0x00),
			Buffer.from([1, 2, 3, 4]),
		]);
		short.writeUInt16LE(4, 0);
		expect(await thpImageFormat.detect(sourceOf(short), "IMAGE.THP")).toBe(
			true,
		);
		const archive = await thpImageFormat.open(sourceOf(short), "IMAGE.THP");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("gates on the extension because it has no signature", async () => {
		const stored = buildThp({ width: 4, pixels: Buffer.alloc(16, 0x11) });
		expect(await thpImageFormat.detect(sourceOf(stored), "IMAGE.BIN")).toBe(
			false,
		);
		expect(await thpImageFormat.detect(sourceOf(stored), "IMAGE.THP")).toBe(
			true,
		);
		expect(await thpImageFormat.detect(sourceOf(stored), "image.thp")).toBe(
			true,
		);
	});

	it("declines zero and oversized dimensions", async () => {
		const zero = buildThp({ width: 0, pixels: Buffer.alloc(4, 0x11) });
		expect(await thpImageFormat.detect(sourceOf(zero), "IMAGE.THP")).toBe(
			false,
		);
		const wide = buildThp({ width: 0x4001, pixels: Buffer.alloc(4, 0x11) });
		expect(await thpImageFormat.detect(sourceOf(wide), "IMAGE.THP")).toBe(
			false,
		);
		expect(
			await thpImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"IMAGE.THP",
			),
		).toBe(false);
	});
});
