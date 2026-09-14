import { BufferByteSource } from "@garbro-mcp/core";
import { fc01TilImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;

interface Record {
	/** Zero leaves the row untouched; the reference reads the patch fields only when it is not zero. */
	flag?: number;
	/** Where the patch starts within the tile's row, in four byte units. */
	offset?: number;
	/** How many four byte units the patch holds; the data's own length by default. */
	length?: number;
	data?: Buffer;
	/** The distance to the next record; the record's own size by default. */
	lineLength?: number;
}

/** Records are stored in the order the reader walks them: a tile row, a tile column, a row of the tile. */
function emitRecords(records: Record[]): Buffer {
	const parts: Buffer[] = [];
	for (const record of records) {
		const flag = record.flag ?? 1;
		const data = record.data ?? Buffer.alloc(0);
		const size = flag !== 0 ? 16 + data.length : 8;
		const encoded: Buffer = Buffer.alloc(size, 0x00);
		encoded.writeUInt32LE(record.lineLength ?? size, 0);
		encoded.writeInt32LE(flag, 4);
		if (flag !== 0) {
			encoded.writeInt32LE(record.offset ?? 0, 8);
			encoded.writeInt32LE(record.length ?? Math.trunc(data.length / 4), 12);
			data.copy(encoded, 16);
		}
		parts.push(encoded);
	}
	return Buffer.concat(parts);
}

function buildTil(options: {
	width: number;
	height: number;
	tileWidth: number;
	tileHeight: number;
	body?: Buffer;
	marker?: string;
	tail?: number;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "TIL0", 0, "latin1");
	header.writeUInt32LE(options.width, 4);
	header.writeUInt32LE(options.height, 8);
	header.writeInt32LE(options.tileWidth, 0xc);
	header.writeInt32LE(options.tileHeight, 0x10);
	return Buffer.concat([
		header,
		options.body ?? Buffer.alloc(0),
		Buffer.alloc(options.tail ?? 0, 0x5a),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "BG01.TIL"): Promise<Buffer> {
	const archive = await fc01TilImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("AGSI tiled image", () => {
	it("declares the TIL0 marker and no extension", async () => {
		expect(fc01TilImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("TIL0", "latin1") },
		]);
		expect(fc01TilImageFormat.descriptor.extensions).toEqual([]);
		const stored = buildTil({
			width: 1,
			height: 1,
			tileWidth: 1,
			tileHeight: 1,
			body: emitRecords([{ data: Buffer.from([1, 2, 3, 4]) }]),
		});
		expect(await fc01TilImageFormat.detect(sourceOf(stored), "A.TIL")).toBe(
			true,
		);
	});

	it("needs its marker, two dimensions and two tile sizes", async () => {
		const body = emitRecords([{ data: Buffer.from([1, 2, 3, 4]) }]);
		const good = { width: 1, height: 1, tileWidth: 1, tileHeight: 1, body };
		expect(
			await fc01TilImageFormat.detect(
				sourceOf(buildTil({ ...good, marker: "TIL1" })),
				"A.TIL",
			),
		).toBe(false);
		// The reference divides by the tile size without looking at it, so a zero has to be refused.
		expect(
			await fc01TilImageFormat.detect(
				sourceOf(buildTil({ ...good, tileWidth: 0 })),
				"A.TIL",
			),
		).toBe(false);
		expect(
			await fc01TilImageFormat.detect(
				sourceOf(buildTil({ ...good, tileHeight: -1 })),
				"A.TIL",
			),
		).toBe(false);
		expect(
			await fc01TilImageFormat.detect(
				sourceOf(buildTil({ ...good, width: 0 })),
				"A.TIL",
			),
		).toBe(false);
		expect(
			await fc01TilImageFormat.detect(
				sourceOf(buildTil(good).subarray(0, HEADER_SIZE - 1)),
				"A.TIL",
			),
		).toBe(false);
	});

	it("describes a thirty two bit image", async () => {
		const body = emitRecords([
			{ data: Buffer.from([1, 2, 3, 4]) },
			{ data: Buffer.from([5, 6, 7, 8]) },
		]);
		const archive = await fc01TilImageFormat.open(
			sourceOf(
				buildTil({ width: 1, height: 2, tileWidth: 1, tileHeight: 2, body }),
			),
			"BG01.TIL",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 1,
				height: 2,
				bitsPerPixel: 32,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "tile-records",
			});
		} finally {
			await archive.close();
		}
	});

	it("patches every row of a single tile", async () => {
		const first = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const second = Buffer.from([
			13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24,
		]);
		const output = await extract(
			buildTil({
				width: 3,
				height: 2,
				tileWidth: 3,
				tileHeight: 2,
				body: emitRecords([{ data: first }, { data: second }]),
			}),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		// No flip in the reference, so the height is negative.
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(54, 66)).toEqual(first);
		expect(output.subarray(66, 78)).toEqual(second);
	});

	it("leaves a row alone when the record's flag is zero", async () => {
		const output = await extract(
			buildTil({
				width: 2,
				height: 2,
				tileWidth: 2,
				tileHeight: 2,
				body: emitRecords([
					{ data: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]) },
					{ flag: 0 },
				]),
			}),
		);
		expect(output.subarray(54, 62)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		);
		expect(output.subarray(62, 70)).toEqual(Buffer.alloc(8));
	});

	it("patches only the part of a row the record names", async () => {
		// Two pixels in the middle of a two pixel row of four bytes each: the rest of the row keeps its zeroes.
		const output = await extract(
			buildTil({
				width: 4,
				height: 1,
				tileWidth: 4,
				tileHeight: 1,
				body: emitRecords([
					{ offset: 1, length: 2, data: Buffer.from([9, 9, 9, 9, 8, 8, 8, 8]) },
				]),
			}),
		);
		expect(output.subarray(54, 70)).toEqual(
			Buffer.concat([
				Buffer.alloc(4),
				Buffer.from([9, 9, 9, 9, 8, 8, 8, 8]),
				Buffer.alloc(4),
			]),
		);
	});

	it("walks the tiles of a row from left to right", async () => {
		// Two tiles of one row each, side by side: the second record lands two pixels into the row.
		const output = await extract(
			buildTil({
				width: 4,
				height: 1,
				tileWidth: 2,
				tileHeight: 1,
				body: emitRecords([
					{ data: Buffer.from([1, 1, 1, 1, 2, 2, 2, 2]) },
					{ data: Buffer.from([3, 3, 3, 3, 4, 4, 4, 4]) },
				]),
			}),
		);
		expect(output.subarray(54, 70)).toEqual(
			Buffer.from([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]),
		);
	});

	it("leaves the remainder of a width the tile size does not divide", async () => {
		// Five pixels in tiles of two leave a column the loop never reaches, which stays blank.
		const rows = [
			{ data: Buffer.from([1, 1, 1, 1, 2, 2, 2, 2]) },
			{ data: Buffer.from([3, 3, 3, 3, 4, 4, 4, 4]) },
		];
		const output = await extract(
			buildTil({
				width: 5,
				height: 1,
				tileWidth: 2,
				tileHeight: 1,
				body: emitRecords(rows),
			}),
		);
		expect(output.subarray(54, 74)).toEqual(
			Buffer.concat([
				Buffer.from([1, 1, 1, 1, 2, 2, 2, 2, 3, 3, 3, 3, 4, 4, 4, 4]),
				Buffer.alloc(4),
			]),
		);
	});

	it("refuses a record that is cut short or leaves the image", async () => {
		// A patch that would write past the end of the pixel buffer.
		const runaway = buildTil({
			width: 2,
			height: 1,
			tileWidth: 2,
			tileHeight: 1,
			body: emitRecords([{ offset: 1, length: 4, data: Buffer.alloc(16) }]),
		});
		await expect(extract(runaway)).rejects.toThrow();
		// A body that stops in the middle of the first record.
		const truncated = buildTil({
			width: 2,
			height: 1,
			tileWidth: 2,
			tileHeight: 1,
			body: Buffer.from([0x10, 0x00, 0x00, 0x00]),
		});
		await expect(extract(truncated)).rejects.toThrow();
	});

	it("names the entry after the image", async () => {
		const body = emitRecords([{ data: Buffer.from([1, 2, 3, 4]) }]);
		const archive = await fc01TilImageFormat.open(
			sourceOf(
				buildTil({ width: 1, height: 1, tileWidth: 1, tileHeight: 1, body }),
			),
			"sub/BG07.TIL",
		);
		try {
			expect(archive.entries[0]?.path).toBe("BG07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.compressed).toBe(true);
		} finally {
			await archive.close();
		}
	});
});
