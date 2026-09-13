import { BufferByteSource } from "@garbro-mcp/core";
import { tblImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x14;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 256 * 4;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

interface Built {
	file: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
	stride: number;
}

/** Builds an image: the signature, the dimensions and top down eight bit pixels. */
function buildTbl(width = 0x11, height = 4): Built {
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 3) & 0xff;
	const head = Buffer.alloc(HEADER_SIZE, 0x11);
	head.write("tbl", 0, "latin1");
	head[3] = 0;
	head.writeUInt32LE(width, 12);
	head.writeUInt32LE(height, 16);
	return {
		file: Buffer.concat([head, pixels]),
		pixels,
		width,
		height,
		stride: (width + 3) & ~3,
	};
}

/** The rows the port is expected to produce, padding included. */
function expectedRows(built: Built): Buffer {
	const rows: Buffer[] = [];
	for (let row = 0; row < built.height; row += 1) {
		const line = Buffer.alloc(built.stride);
		built.pixels.copy(
			line,
			0,
			row * built.width,
			row * built.width + built.width,
		);
		rows.push(line);
	}
	return Buffer.concat(rows);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("pan tbl image", () => {
	it("declares the tbl signature for the registry", () => {
		expect(tblImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x74, 0x62, 0x6c, 0x00]) },
		]);
	});

	it("wraps the pixels in a grey bitmap", async () => {
		const built = buildTbl();
		const source = sourceOf(built.file);
		expect(await tblImageFormat.detect(source, "MASK01.TBL")).toBe(true);
		const archive = await tblImageFormat.open(source, "MASK01.TBL");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"MASK01.bmp",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 0x11,
				height: 4,
				bitsPerPixel: 8,
			});
			expect(archive.metadata).toMatchObject({ image: "bmp", width: 0x11 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			const rows = expectedRows(built);
			expect(output.length).toBe(DATA_OFFSET + rows.length);
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(output.readUInt32LE(2)).toBe(output.length);
			expect(output.readUInt32LE(10)).toBe(DATA_OFFSET);
			expect(output.readUInt32LE(14)).toBe(40);
			expect(output.readInt32LE(18)).toBe(0x11);
			// A negative height keeps the reference's top down byte order.
			expect(output.readInt32LE(22)).toBe(-4);
			expect(output.readUInt16LE(26)).toBe(1);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(30)).toBe(0);
			expect(output.readUInt32LE(34)).toBe(rows.length);
			expect(output.readUInt32LE(46)).toBe(256);
			// A full grey palette, then the padded rows.
			expect(output.subarray(BMP_HEADER_SIZE, DATA_OFFSET).length).toBe(
				PALETTE_SIZE,
			);
			for (const index of [0, 1, 0x7f, 0xff]) {
				expect(output.readUInt8(BMP_HEADER_SIZE + index * 4)).toBe(index);
				expect(output.readUInt8(BMP_HEADER_SIZE + index * 4 + 1)).toBe(index);
				expect(output.readUInt8(BMP_HEADER_SIZE + index * 4 + 2)).toBe(index);
				expect(output.readUInt8(BMP_HEADER_SIZE + index * 4 + 3)).toBe(0);
			}
			expect(output.subarray(DATA_OFFSET)).toEqual(rows);
			// The row padding is visible: three pixels of the first row fit in one byte short.
			expect(output.readUInt8(DATA_OFFSET + 0x11)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const { file } = buildTbl();
		file[0] = 0x75;
		expect(await tblImageFormat.detect(sourceOf(file), "MASK01.TBL")).toBe(
			false,
		);
	});

	it("declines a zero dimension", async () => {
		const { file } = buildTbl();
		file.writeUInt32LE(0, 12);
		expect(await tblImageFormat.detect(sourceOf(file), "MASK01.TBL")).toBe(
			false,
		);
	});

	it("declines dimensions that do not fit the file", async () => {
		const { file } = buildTbl();
		file.writeUInt32LE(0x10000, 16);
		expect(await tblImageFormat.detect(sourceOf(file), "MASK01.TBL")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await tblImageFormat.detect(sourceOf(Buffer.alloc(8)), "MASK01.TBL"),
		).toBe(false);
	});
});
