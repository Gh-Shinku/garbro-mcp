import { BufferByteSource } from "@garbro-mcp/core";
import { hbmImageFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;
const MASK_BYTES = 12;

function strideOf(width: number): number {
	return (width * 2 + 3) & ~3;
}

/** Rows of distinct bytes so a flipped image can be told from a straight one. */
function rowsOf(width: number, height: number): Buffer {
	const stride = strideOf(width);
	const rows = Buffer.alloc(stride * height, 0x00);
	for (let row = 0; row < height; row += 1) {
		for (let index = 0; index < stride; index += 1) {
			rows[row * stride + index] = (row * 0x20 + index + 1) & 0xff;
		}
	}
	return rows;
}

interface HbmOptions {
	marker?: string;
	flags?: number;
	compressed?: boolean;
	skip?: Buffer;
}

function buildHbm(
	width: number,
	height: number,
	rows: Buffer,
	options: HbmOptions = {},
): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "HBM", 0, "latin1");
	header.writeUInt32LE(width, 4);
	header.writeUInt32LE(height, 8);
	header[12] = options.flags ?? (options.compressed ? 0x10 : 0x00);
	const body = options.compressed ? deflateSync(rows) : rows;
	if (options.compressed) {
		// The four bytes before a compressed payload are skipped entirely.
		return Buffer.concat([header, options.skip ?? Buffer.alloc(4, 0xaa), body]);
	}
	return Buffer.concat([header, body]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.hbm"): Promise<Buffer> {
	const archive = await hbmImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("rit's image format", () => {
	it("declares the marker word and no extension", () => {
		expect(hbmImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x48, 0x42, 0x4d, 0x00]) },
		]);
		expect(hbmImageFormat.descriptor.extensions).toEqual([]);
		expect(hbmImageFormat.descriptor.id).toBe("rits-hbm-image");
	});

	it("requires the marker and a whole header", async () => {
		const rows = rowsOf(2, 2);
		expect(
			await hbmImageFormat.detect(sourceOf(buildHbm(2, 2, rows)), "A.hbm"),
		).toBe(true);
		const wrong = buildHbm(2, 2, rows, { marker: "IBM" });
		expect(await hbmImageFormat.detect(sourceOf(wrong), "A.hbm")).toBe(false);
		expect(
			await hbmImageFormat.detect(
				sourceOf(buildHbm(2, 2, rows).subarray(0, HEADER_SIZE - 1)),
				"A.hbm",
			),
		).toBe(false);
	});

	it("reads the two flag bits out of the byte at twelve", async () => {
		const rows = rowsOf(2, 2);
		const cases: Array<[number, boolean, boolean]> = [
			[0x00, false, false],
			[0x10, true, false],
			[0x20, false, true],
			[0x30, true, true],
			// Bits outside the two are not flags and are ignored: 0x3f sets both flags and every lower bit,
			// 0x1f sets 0x10 with them, and 0xcf — which is 0xC0 | 0x0F — sets neither flag at all.
			[0x0f, false, false],
			[0x3f, true, true],
			[0x1f, true, false],
			[0xcf, false, false],
		];
		for (const [flags, compressed, flipped] of cases) {
			const file = buildHbm(2, 2, rows, { flags, compressed });
			const archive = await hbmImageFormat.open(sourceOf(file), "A.hbm");
			try {
				expect(archive.metadata).toMatchObject({ compressed, flipped });
				expect(archive.entries[0]?.metadata).toMatchObject({
					width: 2,
					height: 2,
					bitsPerPixel: 16,
				});
			} finally {
				await archive.close();
			}
		}
	});

	it("writes a top down sixteen bit bitmap with its masks", async () => {
		// Three pixels a row is six bytes, padded to eight, and the padding is carried rather than recomputed.
		const rows = rowsOf(3, 2);
		expect(strideOf(3)).toBe(8);
		const output = await extract(buildHbm(3, 2, rows));
		expect(output.readUInt16LE(0)).toBe(0x4d42);
		expect(output.readUInt16LE(28)).toBe(16);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.readUInt32LE(30)).toBe(3);
		expect(output.readUInt32LE(54)).toBe(0x7c00);
		expect(output.readUInt32LE(58)).toBe(0x03e0);
		expect(output.readUInt32LE(62)).toBe(0x001f);
		expect(output.subarray(BMP_HEADER_SIZE + MASK_BYTES)).toEqual(rows);
	});

	it("decompresses a zlib payload and ignores the four bytes before it", async () => {
		const rows = rowsOf(4, 3);
		const plain = await extract(buildHbm(4, 3, rows));
		const packed = await extract(
			buildHbm(4, 3, rows, {
				compressed: true,
				skip: Buffer.from([1, 2, 3, 4]),
			}),
		);
		expect(packed).toEqual(plain);
	});

	it("places a flipped file's first row last", async () => {
		const rows = rowsOf(2, 3);
		const stride = strideOf(2);
		const output = await extract(buildHbm(2, 3, rows, { flags: 0x20 }));
		const data = output.subarray(BMP_HEADER_SIZE + MASK_BYTES);
		expect(data.subarray(0, stride)).toEqual(rows.subarray(2 * stride));
		expect(data.subarray(stride, 2 * stride)).toEqual(
			rows.subarray(stride, 2 * stride),
		);
		expect(data.subarray(2 * stride)).toEqual(rows.subarray(0, stride));
	});

	it("leaves whatever the stream does not supply as zeroes", async () => {
		const rows = rowsOf(2, 3);
		const stride = strideOf(2);
		// One row's worth of data: straight, it fills the first row and nothing else.
		const straight = await extract(buildHbm(2, 3, rows.subarray(0, stride)));
		expect(straight.subarray(66, 66 + stride)).toEqual(
			rows.subarray(0, stride),
		);
		expect(straight.subarray(66 + stride)).toEqual(
			Buffer.alloc(2 * stride, 0x00),
		);
		// Flipped, the same single row goes to the last one, so the top of the image is the empty part.
		const flipped = await extract(
			buildHbm(2, 3, rows.subarray(0, stride), { flags: 0x20 }),
		);
		expect(flipped.subarray(66, 66 + 2 * stride)).toEqual(
			Buffer.alloc(2 * stride, 0x00),
		);
		expect(flipped.subarray(66 + 2 * stride)).toEqual(rows.subarray(0, stride));
	});

	it("rejects a stream longer than the bitmap it describes", async () => {
		// The port caps the inflate at the size the header asks for; a stream that decodes further fails
		// instead of being truncated.
		const rows = rowsOf(2, 2);
		const oversized = Buffer.concat([
			rows,
			Buffer.alloc(strideOf(2) * 2, 0x11),
		]);
		await expect(
			extract(buildHbm(2, 2, oversized, { compressed: true })),
		).rejects.toThrow();
		// A header with no pixels at all is still a valid bitmap.
		const empty = await extract(buildHbm(0, 0, Buffer.alloc(0)));
		expect(empty.length).toBe(BMP_HEADER_SIZE + MASK_BYTES);
	});
});
