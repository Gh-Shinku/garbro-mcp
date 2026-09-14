import { BufferByteSource } from "@garbro-mcp/core";
import { interheartKgImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const MARKER = Buffer.from("GCGK", "latin1");
const HEADER_SIZE = 12;

type Token = { alpha: number; count: number; pixels?: number[][] };

/** A run token: the alpha byte, the pixel count and, for a visible run, three bytes a pixel. */
function emitRow(tokens: Token[]): Buffer {
	const parts: Buffer[] = [];
	for (const token of tokens) {
		parts.push(Buffer.from([token.alpha, token.count]));
		for (const pixel of token.pixels ?? []) parts.push(Buffer.from(pixel));
	}
	return Buffer.concat(parts);
}

/** Builds an image, storing its rows in the order given and pointing the table at each of them. */
function buildKg(options: {
	width: number;
	height: number;
	rows: Buffer[];
	/** The order the row bodies are stored in, which the table records. */
	storageOrder?: number[];
	packedSize?: number;
	marker?: string;
}): Buffer {
	const height = options.height;
	const order = options.storageOrder ?? options.rows.map((_, index) => index);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "GCGK", 0, "latin1");
	header.writeUInt16LE(options.width, 4);
	header.writeUInt16LE(height, 6);
	const bodies = order.map((index) => options.rows[index] ?? Buffer.alloc(0));
	const total = bodies.reduce((sum, body) => sum + body.length, 0);
	header.writeInt32LE(options.packedSize ?? total, 8);
	const table: Buffer = Buffer.alloc(height * 4, 0x00);
	const offsets = new Map<number, number>();
	let position = 0;
	order.forEach((rowIndex) => {
		offsets.set(rowIndex, position);
		position += (options.rows[rowIndex] ?? Buffer.alloc(0)).length;
	});
	options.rows.forEach((_, rowIndex) => {
		table.writeUInt32LE(offsets.get(rowIndex) ?? 0, rowIndex * 4);
	});
	return Buffer.concat([header, table, ...bodies]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.KG"): Promise<Buffer> {
	const archive = await interheartKgImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The pixels of a thirty two bit bitmap, found through the offset its header records. */
function pixelsOf(output: Buffer): Buffer {
	return output.subarray(output.readUInt32LE(10));
}

describe("Interheart image", () => {
	it("declares the GCGK signature and no extension", async () => {
		expect(interheartKgImageFormat.detection?.signatures).toEqual([
			{ bytes: MARKER },
		]);
		expect(interheartKgImageFormat.descriptor.extensions).toEqual([]);
		const stored = buildKg({
			width: 1,
			height: 1,
			rows: [emitRow([{ alpha: 0xff, count: 1, pixels: [[1, 2, 3]] }])],
		});
		expect(await interheartKgImageFormat.detect(sourceOf(stored), "A.KG")).toBe(
			true,
		);
	});

	it("needs a marker, a positive packed size and dimensions", async () => {
		const row = emitRow([{ alpha: 0xff, count: 1, pixels: [[1, 2, 3]] }]);
		const good = { width: 1, height: 1, rows: [row] };
		expect(
			await interheartKgImageFormat.detect(
				sourceOf(buildKg({ ...good, marker: "GCGX" })),
				"A.KG",
			),
		).toBe(false);
		expect(
			await interheartKgImageFormat.detect(
				sourceOf(buildKg({ ...good, packedSize: 0 })),
				"A.KG",
			),
		).toBe(false);
		expect(
			await interheartKgImageFormat.detect(
				sourceOf(buildKg({ ...good, packedSize: -4 })),
				"A.KG",
			),
		).toBe(false);
		expect(
			await interheartKgImageFormat.detect(
				sourceOf(buildKg({ ...good, width: 0 })),
				"A.KG",
			),
		).toBe(false);
		expect(
			await interheartKgImageFormat.detect(
				sourceOf(buildKg({ ...good }).subarray(0, 11)),
				"A.KG",
			),
		).toBe(false);
	});

	it("describes a thirty two bit image", async () => {
		const stored = buildKg({
			width: 2,
			height: 1,
			rows: [
				emitRow([
					{
						alpha: 0x80,
						count: 2,
						pixels: [
							[1, 2, 3],
							[4, 5, 6],
						],
					},
				]),
			],
		});
		const archive = await interheartKgImageFormat.open(
			sourceOf(stored),
			"CG01.KG",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 1,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "kg-alpha-runs",
			});
		} finally {
			await archive.close();
		}
	});

	it("turns a visible run into BGRA pixels", async () => {
		const stored = buildKg({
			width: 2,
			height: 1,
			rows: [
				emitRow([
					{
						alpha: 0x80,
						count: 2,
						pixels: [
							[0x11, 0x22, 0x33],
							[0x44, 0x55, 0x66],
						],
					},
				]),
			],
		});
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(32);
		// The reference never flips it, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-1);
		// The stream holds red, green and blue; the bitmap holds blue, green, red and the alpha.
		expect(pixelsOf(output).subarray(0, 8)).toEqual(
			Buffer.from([0x33, 0x22, 0x11, 0x80, 0x66, 0x55, 0x44, 0x80]),
		);
	});

	it("leaves the pixels of a transparent run as zeroes, alpha included", async () => {
		const stored = buildKg({
			width: 3,
			height: 1,
			rows: [
				emitRow([
					{ alpha: 0x00, count: 1 },
					{
						alpha: 0xff,
						count: 2,
						pixels: [
							[7, 8, 9],
							[10, 11, 12],
						],
					},
				]),
			],
		});
		const pixels = pixelsOf(await extract(stored));
		expect(pixels.subarray(0, 4)).toEqual(Buffer.alloc(4));
		expect(pixels.subarray(4, 8)).toEqual(Buffer.from([9, 8, 7, 0xff]));
		expect(pixels.subarray(8, 12)).toEqual(Buffer.from([12, 11, 10, 0xff]));
	});

	it("reads a count of zero as a whole row of 0x100 pixels", async () => {
		const colours = Array.from({ length: 0x100 }, (_, index) => [
			index & 0xff,
			0,
			0,
		]);
		const stored = buildKg({
			width: 0x100,
			height: 1,
			rows: [emitRow([{ alpha: 0xff, count: 0, pixels: colours }])],
		});
		const pixels = pixelsOf(await extract(stored));
		expect(pixels.length).toBe(0x100 * 4);
		expect(pixels.subarray(0xff * 4, 0x100 * 4)).toEqual(
			Buffer.from([0x00, 0x00, 0xff, 0xff]),
		);
	});

	it("takes every row from the offset its table entry gives", async () => {
		const first = emitRow([{ alpha: 0xff, count: 1, pixels: [[1, 1, 1]] }]);
		const second = emitRow([{ alpha: 0xff, count: 1, pixels: [[2, 2, 2]] }]);
		// The second row's body is stored first, so the table is what puts them in order.
		const stored = buildKg({
			width: 1,
			height: 2,
			rows: [first, second],
			storageOrder: [1, 0],
		});
		const pixels = pixelsOf(await extract(stored));
		expect(pixels.subarray(0, 4)).toEqual(Buffer.from([1, 1, 1, 0xff]));
		expect(pixels.subarray(4, 8)).toEqual(Buffer.from([2, 2, 2, 0xff]));
	});

	it("refuses a run that overruns its row or the file", async () => {
		const overrun = buildKg({
			width: 2,
			height: 1,
			rows: [
				emitRow([
					{
						alpha: 0xff,
						count: 3,
						pixels: [
							[1, 1, 1],
							[2, 2, 2],
							[3, 3, 3],
						],
					},
				]),
			],
		});
		await expect(extract(overrun)).rejects.toThrow();
		// A row whose body is cut short fails too.
		const truncated = buildKg({
			width: 4,
			height: 1,
			rows: [
				emitRow([
					{
						alpha: 0xff,
						count: 4,
						pixels: [
							[1, 1, 1],
							[2, 2, 2],
						],
					},
				]),
			],
		});
		await expect(extract(truncated)).rejects.toThrow();
	});

	it("names the entry after the image", async () => {
		const stored = buildKg({
			width: 1,
			height: 1,
			rows: [emitRow([{ alpha: 0xff, count: 1, pixels: [[1, 2, 3]] }])],
		});
		const archive = await interheartKgImageFormat.open(
			sourceOf(stored),
			"sub/CG07.KG",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.compressed).toBe(true);
		} finally {
			await archive.close();
		}
	});
});
