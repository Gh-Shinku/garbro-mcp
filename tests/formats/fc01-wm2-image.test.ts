import { BufferByteSource } from "@garbro-mcp/core";
import { wm2ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("2.0", "ascii");
const HEADER_SIZE = 12;
const TABLE_ROW_SIZE = 16;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;

interface Row {
	/** The first word is only tested for zero; any other value means the row is patched. */
	flag?: number;
	position: number;
	count: number;
	from: number;
}

function buildWm2(options: {
	width: number;
	height: number;
	rows: Array<Row | null>;
	pool: Buffer;
}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt32LE(options.width, 4);
	header.writeUInt32LE(options.height, 8);
	const table: Buffer = Buffer.alloc(options.height * TABLE_ROW_SIZE, 0x00);
	for (let y = 0; y < options.height; y += 1) {
		const row = options.rows[y];
		if (!row) continue;
		const at = y * TABLE_ROW_SIZE;
		table.writeInt32LE(row.flag ?? 1, at);
		table.writeInt32LE(row.position, at + 4);
		table.writeInt32LE(row.count, at + 8);
		table.writeInt32LE(row.from, at + 12);
	}
	return Buffer.concat([header, table, options.pool]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer): Promise<Buffer> {
	const archive = await wm2ImageFormat.open(sourceOf(stored), "MASK.WM2");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The bitmap body of a four pixel wide image, one row a line. */
function body(output: Buffer): Buffer {
	return output.subarray(BMP_HEADER_SIZE + PALETTE_SIZE);
}

describe("fc01 wm2 mask", () => {
	it("declares the 2.0 signature and no extension", () => {
		expect(wm2ImageFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("2.0");
		expect(wm2ImageFormat.descriptor.extensions).toEqual([]);
	});

	it("patches the rows from the pool after the table", async () => {
		// Two rows of four bytes. The first takes three bytes from pool offset zero and puts them two bytes
		// into its row; the second takes two bytes from pool offset three, which overlaps the first range.
		const pool = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55]);
		const stored = buildWm2({
			width: 4,
			height: 2,
			rows: [
				{ position: 2, count: 3, from: 0 },
				{ position: 0, count: 2, from: 3 },
			],
			pool,
		});
		const source = sourceOf(stored);
		expect(await wm2ImageFormat.detect(source, "MASK.WM2")).toBe(true);
		const archive = await wm2ImageFormat.open(source, "MASK.WM2");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["MASK.bmp"]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 4,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(body(output)).toEqual(
			Buffer.from([0x00, 0x00, 0x11, 0x22, 0x44, 0x55, 0x00, 0x00]),
		);
	});

	it("leaves a row whose flag word is zero untouched", async () => {
		// The second row is all zeroes because its flag is zero, and the three words after it are junk.
		const pool = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
		const stored = buildWm2({
			width: 4,
			height: 2,
			rows: [
				{ position: 0, count: 4, from: 0 },
				{ flag: 0, position: 99, count: 99, from: 99 },
			],
			pool,
		});
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0x00, 0x00, 0x00, 0x00]),
		);
	});

	it("accepts any non zero flag word", async () => {
		const pool = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		for (const flag of [1, -1, 0x7fffffff]) {
			const stored = buildWm2({
				width: 4,
				height: 1,
				rows: [{ flag, position: 0, count: 4, from: 0 }],
				pool,
			});
			const output = await extract(stored);
			expect(body(output)).toEqual(pool);
		}
	});

	it("pads rows the bitmap way", async () => {
		// Three bytes a row pad to four, and the padding is the writer's, not the pool's.
		const pool = Buffer.from([0x77, 0x88, 0x99]);
		const stored = buildWm2({
			width: 3,
			height: 2,
			rows: [
				{ position: 0, count: 3, from: 0 },
				{ position: 0, count: 3, from: 0 },
			],
			pool,
		});
		const output = await extract(stored);
		expect(body(output)).toEqual(
			Buffer.from([0x77, 0x88, 0x99, 0x00, 0x77, 0x88, 0x99, 0x00]),
		);
	});

	it("copies nothing when the source range is past the file", async () => {
		const pool = Buffer.from([0x01, 0x02]);
		const stored = buildWm2({
			width: 2,
			height: 1,
			rows: [{ position: 0, count: 2, from: 100 }],
			pool,
		});
		// Reading past the end of a stream yields nothing rather than failing.
		const output = await extract(stored);
		expect(body(output)).toEqual(Buffer.alloc(4));
	});

	it("fails when a row reaches past the image", async () => {
		const pool = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const stored = buildWm2({
			width: 2,
			height: 2,
			rows: [{ position: 2, count: 4, from: 0 }, null],
			pool,
		});
		const source = sourceOf(stored);
		expect(await wm2ImageFormat.detect(source, "MASK.WM2")).toBe(true);
		const archive = await wm2ImageFormat.open(source, "MASK.WM2");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("lists a file truncated inside the table but fails to extract it", async () => {
		const pool = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const stored = buildWm2({
			width: 2,
			height: 3,
			rows: [null, null, null],
			pool,
		});
		const short = stored.subarray(0, HEADER_SIZE + 20);
		const source = sourceOf(short);
		expect(await wm2ImageFormat.detect(source, "MASK.WM2")).toBe(true);
		const archive = await wm2ImageFormat.open(source, "MASK.WM2");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow();
		} finally {
			await archive.close();
		}
	});

	it("declines zero, oversized and missing dimensions", async () => {
		const pool = Buffer.alloc(4);
		const cases: Array<[number, number]> = [
			[0, 2],
			[2, 0],
			[0x8001, 2],
			[2, 0x8001],
		];
		for (const [width, height] of cases) {
			const stored = buildWm2({
				width,
				height: height > 4 ? 4 : height,
				rows: [null, null, null, null],
				pool,
			});
			// The header word carries the value the case is about, whatever the table holds.
			stored.writeUInt32LE(height, 8);
			expect(await wm2ImageFormat.detect(sourceOf(stored), "MASK.WM2")).toBe(
				false,
			);
		}
		const wrong = buildWm2({ width: 2, height: 1, rows: [null], pool });
		wrong[2] = 0x58;
		expect(await wm2ImageFormat.detect(sourceOf(wrong), "MASK.WM2")).toBe(
			false,
		);
		expect(
			await wm2ImageFormat.detect(
				sourceOf(
					buildWm2({ width: 2, height: 1, rows: [null], pool }).subarray(0, 11),
				),
				"MASK.WM2",
			),
		).toBe(false);
	});
});
