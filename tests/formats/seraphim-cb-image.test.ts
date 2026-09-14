import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { seraphimCbImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;
const PALETTE_BYTES = 0x400;
const BMP_PIXELS_OFFSET = BMP_HEADER_SIZE + PALETTE_BYTES;
/** A single byte row of a bitmap is padded to a four byte stride. */
const rowSize = (width: number): number => (width + 3) & ~3;

interface CbOptions {
	width?: number;
	height?: number;
	colors?: number;
	/** The colour map, three bytes to a colour and as many as the header counts. */
	palette?: number[];
	/** The pixel stream behind the colour map. */
	stream?: Buffer;
	packedSize?: number;
	header?: (header: Buffer) => void;
}

function buildCbFile(options: CbOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const colors = options.colors ?? 2;
	const palette = Buffer.from(
		options.palette ?? [0x10, 0x20, 0x30, 0x40, 0x50, 0x60],
	);
	const stream = options.stream ?? Buffer.from([3, 0, 1, 1, 0]);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("CB", 0, "latin1");
	header.writeUInt16LE(colors, 2);
	header.writeInt16LE(2, 4);
	header.writeInt16LE(-5, 6);
	header.writeInt16LE(width, 8);
	header.writeInt16LE(height, 10);
	header.writeInt32LE(options.packedSize ?? stream.length, 12);
	options.header?.(header);
	return Buffer.concat([header, palette, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await seraphimCbImageFormat.open(sourceOf(file), "CG01.cb");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

function paletteAt(bmp: Buffer, index: number): number[] {
	const offset = BMP_HEADER_SIZE + index * 4;
	return [
		bmp[offset] ?? 0,
		bmp[offset + 1] ?? 0,
		bmp[offset + 2] ?? 0,
		bmp[offset + 3] ?? 0,
	];
}

function indexAt(bmp: Buffer, x: number, y: number, width: number): number {
	return bmp[BMP_PIXELS_OFFSET + y * rowSize(width) + x] ?? 0;
}

describe("Seraphim CB image", () => {
	it("takes a file whose header is sound and refuses the rest", async () => {
		expect(seraphimCbImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x43, 0x42, 0x00, 0x01]) },
		]);
		expect(
			await seraphimCbImageFormat.detect(sourceOf(buildCbFile()), "a.cb"),
		).toBe(true);
		// The word the reference registers names the usual colour count, but its reader only wants the letters.
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ colors: 0x100 })),
				"a.clb",
			),
		).toBe(true);
		// More colours than the reference reads.
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ colors: 0x101 })),
				"a.cb",
			),
		).toBe(false);
		// Measurements of nought or less, and a stream of nought.
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ width: 0 })),
				"a.cb",
			),
		).toBe(false);
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ width: -1 })),
				"a.cb",
			),
		).toBe(false);
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ height: 0 })),
				"a.cb",
			),
		).toBe(false);
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ packedSize: 0 })),
				"a.cb",
			),
		).toBe(false);
		// The letters of the other pictures of this engine.
		expect(
			await seraphimCbImageFormat.detect(
				sourceOf(buildCbFile({ header: (h) => h.write("CF", 0, "latin1") })),
				"a.cb",
			),
		).toBe(false);
		expect(
			await seraphimCbImageFormat.detect(sourceOf(Buffer.alloc(8)), "a.cb"),
		).toBe(false);
	});

	it("stores the colour map the way a bitmap wants it", async () => {
		const file = buildCbFile({ palette: [0x10, 0x20, 0x30, 0x40, 0x50, 0x60] });
		const archive = await seraphimCbImageFormat.open(sourceOf(file), "CG01.cb");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 8,
				offsetX: 2,
				offsetY: -5,
				colors: 2,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "seraphim-byte-rle",
				width: 2,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect(bmp.readInt32LE(22)).toBe(-2);
		// The reference reads the map as red, green, blue and builds a colour of it.
		expect(paletteAt(bmp, 0)).toEqual([0x30, 0x20, 0x10, 0x00]);
		expect(paletteAt(bmp, 1)).toEqual([0x60, 0x50, 0x40, 0x00]);
		// The colours the header does not count stay black.
		expect(paletteAt(bmp, 2)).toEqual([0x00, 0x00, 0x00, 0x00]);
	});

	it("flips the rows of the eight bit picture", async () => {
		const file = buildCbFile({ stream: Buffer.from([3, 0, 1, 1, 0]) });
		const bmp = await extract(file);
		expect(indexAt(bmp, 0, 0, 2)).toBe(1);
		expect(indexAt(bmp, 1, 0, 2)).toBe(0);
		expect(indexAt(bmp, 0, 1, 2)).toBe(0);
		expect(indexAt(bmp, 1, 1, 2)).toBe(1);
	});

	it("copies a run of bytes from a row above", async () => {
		// A four pixel row read as it stands, then an opcode that repeats three of its bytes.
		const file = buildCbFile({
			width: 4,
			height: 2,
			stream: Buffer.concat([
				Buffer.from([3, 0x11, 0x22, 0x33, 0x44]),
				Buffer.from([0x90, 2]),
			]),
		});
		const bmp = await extract(file);
		expect(indexAt(bmp, 0, 0, 4)).toBe(0x11);
		expect(indexAt(bmp, 1, 0, 4)).toBe(0x22);
		expect(indexAt(bmp, 2, 0, 4)).toBe(0x33);
		// The copy counted three bytes, so the last of the row is what the picture was allocated with.
		expect(indexAt(bmp, 3, 0, 4)).toBe(0x00);
		expect(indexAt(bmp, 0, 1, 4)).toBe(0x11);
		expect(indexAt(bmp, 2, 1, 4)).toBe(0x33);
		expect(indexAt(bmp, 3, 1, 4)).toBe(0x44);
	});

	it("repeats a pattern and single bytes", async () => {
		// Two bytes read as a pattern, then repeated once: four bytes of a two byte pattern.
		const patterned = buildCbFile({
			stream: Buffer.concat([
				Buffer.from([0xc0, 1]),
				Buffer.from([5, 6, 7, 8]),
			]),
		});
		const first = await extract(patterned);
		expect(indexAt(first, 0, 1, 2)).toBe(5);
		expect(indexAt(first, 1, 1, 2)).toBe(6);
		expect(indexAt(first, 0, 0, 2)).toBe(5);
		expect(indexAt(first, 1, 0, 2)).toBe(6);
		// One byte of the picture, then an opcode that repeats the byte before it three times over.
		const filled = buildCbFile({
			width: 3,
			height: 1,
			stream: Buffer.concat([
				Buffer.from([0, 0x99]),
				Buffer.from([0xe0, 0, 2]),
			]),
		});
		const second = await extract(filled);
		expect(indexAt(second, 0, 0, 3)).toBe(0x99);
		expect(indexAt(second, 1, 0, 3)).toBe(0x99);
		expect(indexAt(second, 2, 0, 3)).toBe(0x99);
	});

	it("keeps the picture whole when the stream ends early", async () => {
		const file = buildCbFile({
			stream: Buffer.from([3, 0, 1]),
			packedSize: 3,
		});
		const bmp = await extract(file);
		expect(indexAt(bmp, 0, 1, 2)).toBe(0);
		expect(indexAt(bmp, 1, 1, 2)).toBe(1);
		expect(indexAt(bmp, 0, 0, 2)).toBe(0);
		expect(indexAt(bmp, 1, 0, 2)).toBe(0);
	});

	it("stops on an opcode the reference does not know", async () => {
		const file = buildCbFile({
			stream: Buffer.concat([Buffer.from([0, 0x12]), Buffer.from([0xf7])]),
		});
		const archive = await seraphimCbImageFormat.open(sourceOf(file), "CG01.cb");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Invalid Seraphim image opcode",
			});
		} finally {
			await archive.close();
		}
	});

	it("reads a picture of no colours as one of black", async () => {
		const file = buildCbFile({ colors: 0, palette: [] });
		expect(await seraphimCbImageFormat.detect(sourceOf(file), "a.cb")).toBe(
			true,
		);
		// No colour map at all means the stream starts right behind the header.
		const bmp = await extract(file);
		expect(paletteAt(bmp, 0)).toEqual([0x00, 0x00, 0x00, 0x00]);
		expect(indexAt(bmp, 0, 0, 2)).toBe(1);
		expect(indexAt(bmp, 0, 1, 2)).toBe(0);
	});
});
