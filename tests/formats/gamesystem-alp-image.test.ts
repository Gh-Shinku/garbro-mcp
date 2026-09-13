import { BufferByteSource } from "@garbro-mcp/core";
import {
	gamesystemAlpImageDescriptor,
	gamesystemAlpImageFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const BMP_HEADER_SIZE = 54;
const PALETTE_SIZE = 1024;
const DATA_OFFSET = BMP_HEADER_SIZE + PALETTE_SIZE;

interface Built {
	file: Buffer;
	pixels: Buffer;
	width: number;
	height: number;
}

/** Eight bytes of dimensions followed by one byte per pixel. */
function buildAlp(width = 3, height = 2): Built {
	const pixels: Buffer = Buffer.alloc(width * height);
	for (let i = 0; i < pixels.length; i += 1) pixels[i] = (i * 17) & 0xff;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.writeUInt32LE(width, 0);
	header.writeUInt32LE(height, 4);
	return { file: Buffer.concat([header, pixels]), pixels, width, height };
}

/** The bitmap rows, padded to four bytes, in the stored bottom up order. */
function expectedRows(built: Built): Buffer {
	const stride = (built.width + 3) & ~3;
	const rows: Buffer[] = [];
	for (let row = 0; row < built.height; row += 1) {
		const line: Buffer = Buffer.alloc(stride);
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

describe("gamesystem alp image", () => {
	it("declares no signature and the alp extension", () => {
		expect(gamesystemAlpImageFormat.detection?.signatures).toEqual([]);
		expect(gamesystemAlpImageDescriptor.extensions).toEqual(["alp"]);
	});

	it("writes a bottom up grey bitmap", async () => {
		const built = buildAlp();
		const source = sourceOf(built.file);
		expect(await gamesystemAlpImageFormat.detect(source, "MASK01.ALP")).toBe(
			true,
		);
		const archive = await gamesystemAlpImageFormat.open(source, "MASK01.ALP");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"MASK01.bmp",
			]);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 3,
				height: 2,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 3,
				height: 2,
				bitsPerPixel: 8,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(built.pixels.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(0, 2).toString("latin1")).toBe("BM");
			// `ImageData.CreateFlipped` stores bottom up rows, so the height stays positive.
			expect(output.readInt32LE(22)).toBe(built.height);
			expect(output.readUInt32LE(18)).toBe(built.width);
			expect(output.readUInt16LE(28)).toBe(8);
			expect(output.readUInt32LE(10)).toBe(DATA_OFFSET);
			expect(output.readUInt32LE(46)).toBe(256);
			// Three pixel rows are padded to four bytes each.
			expect(output.length).toBe(DATA_OFFSET + expectedRows(built).length);
			expect(output.subarray(DATA_OFFSET)).toEqual(expectedRows(built));
			expect(output.subarray(DATA_OFFSET)).toEqual(
				Buffer.from([0x00, 0x11, 0x22, 0x00, 0x33, 0x44, 0x55, 0x00]),
			);
		} finally {
			await archive.close();
		}
	});

	it("accepts an upper case extension", async () => {
		expect(
			await gamesystemAlpImageFormat.detect(sourceOf(buildAlp().file), "M.ALP"),
		).toBe(true);
	});

	it("declines a file whose name is not alp", async () => {
		expect(
			await gamesystemAlpImageFormat.detect(sourceOf(buildAlp().file), "M.BIN"),
		).toBe(false);
	});

	it("declines a length that does not match the dimensions", async () => {
		const built = buildAlp();
		const stored = Buffer.concat([built.file, Buffer.from([0x00])]);
		expect(
			await gamesystemAlpImageFormat.detect(sourceOf(stored), "M.ALP"),
		).toBe(false);
		const shorter = built.file.subarray(0, built.file.length - 1);
		expect(
			await gamesystemAlpImageFormat.detect(sourceOf(shorter), "M.ALP"),
		).toBe(false);
	});

	it("declines zero dimensions", async () => {
		const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
		expect(
			await gamesystemAlpImageFormat.detect(sourceOf(header), "M.ALP"),
		).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await gamesystemAlpImageFormat.detect(sourceOf(Buffer.alloc(4)), "M.ALP"),
		).toBe(false);
	});
});
