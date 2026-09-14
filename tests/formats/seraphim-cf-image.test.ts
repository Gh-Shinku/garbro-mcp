import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { seraphimCfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;
/** A three byte row of a bitmap is padded to a four byte stride. */
const rowSize = (width: number): number => Math.ceil((width * 3) / 4) * 4;

interface CfOptions {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	/** The compressed stream, which the header measures. */
	stream?: Buffer;
	version?: number;
	/** Overrides the length the header claims the stream has. */
	packedSize?: number;
	/** Overrides a byte of the header, to make a file that is not this format's. */
	header?: (header: Buffer) => void;
}

function buildCfFile(options: CfOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const stream = options.stream ?? literalPixels(width * height * 3, 1);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("CF", 0, "latin1");
	header[2] = options.version ?? 0;
	header.writeInt16LE(options.offsetX ?? 0, 4);
	header.writeInt16LE(options.offsetY ?? 0, 6);
	header.writeUInt16LE(width, 8);
	header.writeUInt16LE(height, 10);
	header.writeInt32LE(options.packedSize ?? stream.length, 12);
	options.header?.(header);
	return Buffer.concat([header, stream]);
}

/** One literal run: a control byte below 0x40 is a length of one to sixty four, then the bytes. */
function literals(values: number[] | Buffer): Buffer {
	const data = Buffer.from(values);
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 0x40) {
		const chunk = data.subarray(i, Math.min(i + 0x40, data.length));
		parts.push(Buffer.from([chunk.length - 1]), chunk);
	}
	return Buffer.concat(parts);
}

function literalPixels(count: number, first: number): Buffer {
	return literals(Array.from({ length: count }, (_, i) => (first + i) & 0xff));
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await seraphimCfImageFormat.open(sourceOf(file), "CG01.cts");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The three bytes of a pixel of a three byte picture. */
function pixelAt(bmp: Buffer, x: number, y: number, width: number): number[] {
	const offset = BMP_HEADER_SIZE + y * rowSize(width) + x * 3;
	return [bmp[offset] ?? 0, bmp[offset + 1] ?? 0, bmp[offset + 2] ?? 0];
}

describe("Seraphim CF image", () => {
	it("takes a file whose header is sound and refuses the rest", async () => {
		expect(seraphimCfImageFormat.detection?.signatures?.length).toBe(6);
		expect(seraphimCfImageFormat.detection?.signatures?.[0]?.bytes).toEqual(
			Buffer.from("CF\0\0", "latin1"),
		);
		expect(
			await seraphimCfImageFormat.detect(sourceOf(buildCfFile()), "a.cts"),
		).toBe(true);
		// Every one of the six words the reference registers.
		for (const version of [0x00, 0x02, 0x04, 0x07, 0x09, 0x14]) {
			expect(
				await seraphimCfImageFormat.detect(
					sourceOf(buildCfFile({ version })),
					"a.cts",
				),
			).toBe(true);
		}
		// A version the reference does not register is still taken when its header is sound, which is the pass
		// its signature list ends in.
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ version: 0x33 })),
				"a.cts",
			),
		).toBe(true);
		// The fourth byte has to be nought, and the two letters have to be there.
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ header: (h) => h.writeUInt8(1, 3) })),
				"a.cts",
			),
		).toBe(false);
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ header: (h) => h.write("CX", 0, "latin1") })),
				"a.cts",
			),
		).toBe(false);
		// A stream that is not there, or longer than the file holds.
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ packedSize: 0 })),
				"a.cts",
			),
		).toBe(false);
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ packedSize: 13, stream: Buffer.alloc(8) })),
				"a.cts",
			),
		).toBe(false);
		// Measurements of nought.
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ width: 0 })),
				"a.cts",
			),
		).toBe(false);
		expect(
			await seraphimCfImageFormat.detect(
				sourceOf(buildCfFile({ height: 0 })),
				"a.cts",
			),
		).toBe(false);
		expect(
			await seraphimCfImageFormat.detect(sourceOf(Buffer.alloc(8)), "a.cts"),
		).toBe(false);
	});

	it("turns a bottom up picture into a top down bitmap", async () => {
		const file = buildCfFile({
			offsetX: -3,
			offsetY: 7,
			stream: literals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
		});
		const archive = await seraphimCfImageFormat.open(
			sourceOf(file),
			"CG01.cts",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				offsetX: -3,
				offsetY: 7,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "seraphim-pixel-rle",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// The rows of the file run from the bottom up, so the bitmap starts with the last one.
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([7, 8, 9]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([10, 11, 12]);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([1, 2, 3]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([4, 5, 6]);
	});

	it("copies a run of pixels from a row above", async () => {
		// A three pixel row, then an opcode that repeats eight of its nine bytes.
		const stream = Buffer.concat([
			literals([0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x31, 0x32, 0x33]),
			Buffer.from([0x90, 7]),
		]);
		const file = buildCfFile({ width: 3, height: 2, stream });
		const bmp = await extract(file);
		// The opcode moved back a whole row and repeated the eight bytes it counted.
		// The last pixel of the copy stayed as the zero the picture was allocated with.
		expect(pixelAt(bmp, 0, 0, 3)).toEqual([0x11, 0x12, 0x13]);
		expect(pixelAt(bmp, 1, 0, 3)).toEqual([0x21, 0x22, 0x23]);
		expect(pixelAt(bmp, 2, 0, 3)).toEqual([0x31, 0x32, 0x00]);
		// And the row it was copied from is whole.
		expect(pixelAt(bmp, 0, 1, 3)).toEqual([0x11, 0x12, 0x13]);
		expect(pixelAt(bmp, 1, 1, 3)).toEqual([0x21, 0x22, 0x23]);
		expect(pixelAt(bmp, 2, 1, 3)).toEqual([0x31, 0x32, 0x33]);
	});

	it("fills a run of one byte and repeats a pattern", async () => {
		const file = buildCfFile({
			stream: Buffer.concat([
				// A short fill of four bytes, then a literal run of eight.
				Buffer.from([0x42, 0xab]),
				literals([1, 2, 3, 4, 5, 6, 7, 8]),
			]),
		});
		const bmp = await extract(file);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([3, 4, 5]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([6, 7, 8]);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([0xab, 0xab, 0xab]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([0xab, 1, 2]);
		// A pattern of three bytes read as they stand, then repeated as many times as the opcode counts.
		const patterned = buildCfFile({
			width: 2,
			height: 2,
			stream: Buffer.concat([
				Buffer.from([0xc0, 2]),
				Buffer.from([0x77, 0x88, 0x99]),
			]),
		});
		const other = await extract(patterned);
		expect(pixelAt(other, 0, 1, 2)).toEqual([0x77, 0x88, 0x99]);
		expect(pixelAt(other, 1, 1, 2)).toEqual([0x77, 0x88, 0x99]);
	});

	it("keeps the picture whole when the stream ends early", async () => {
		// A literal run that claims twelve bytes where the file holds six: the reference stops there and leaves
		// the rest of the picture as the zeroes it allocated.
		const file = buildCfFile({
			stream: Buffer.concat([
				Buffer.from([11]),
				Buffer.from([1, 2, 3, 4, 5, 6]),
			]),
			packedSize: 7,
		});
		const bmp = await extract(file);
		// The six bytes it did read stand where the run started, and the rows above them stay nought.
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([1, 2, 3]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([4, 5, 6]);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([0, 0, 0]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([0, 0, 0]);
	});

	it("stops on an opcode the reference does not know", async () => {
		const file = buildCfFile({
			stream: Buffer.concat([
				literals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11]),
				Buffer.from([0xf0]),
			]),
		});
		const archive = await seraphimCfImageFormat.open(
			sourceOf(file),
			"CG01.cts",
		);
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

	it("stops on a run that reaches behind the picture", async () => {
		// The first opcode is a row copy with no row above it.
		const file = buildCfFile({
			stream: Buffer.from([0x90, 11]),
		});
		const archive = await seraphimCfImageFormat.open(
			sourceOf(file),
			"CG01.cts",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Seraphim image stream runs past its picture",
			});
		} finally {
			await archive.close();
		}
	});
});
