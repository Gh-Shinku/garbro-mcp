import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { seraphimCxImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const BMP_HEADER_SIZE = 54;

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

interface CxOptions {
	width?: number;
	height?: number;
	stream?: Buffer;
	packedSize?: number;
}

function buildCxFile(options: CxOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 2;
	const stream =
		options.stream ??
		literals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16]);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write("CF", 0, "latin1");
	header.writeInt16LE(4, 4);
	header.writeInt16LE(9, 6);
	header.writeUInt16LE(width, 8);
	header.writeUInt16LE(height, 10);
	header.writeInt32LE(options.packedSize ?? stream.length, 12);
	return Buffer.concat([header, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await seraphimCxImageFormat.open(sourceOf(file), "CG01.cts");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The four bytes of a pixel of a picture that needs no row padding. */
function pixelAt(bmp: Buffer, x: number, y: number, width: number): number[] {
	const offset = BMP_HEADER_SIZE + (y * width + x) * 4;
	return [
		bmp[offset] ?? 0,
		bmp[offset + 1] ?? 0,
		bmp[offset + 2] ?? 0,
		bmp[offset + 3] ?? 0,
	];
}

describe("Seraphim CX image", () => {
	it("is found by the words of the three byte picture", async () => {
		expect(seraphimCxImageFormat.detection?.signatures?.length).toBe(6);
		expect(
			await seraphimCxImageFormat.detect(sourceOf(buildCxFile()), "a.cts"),
		).toBe(true);
		expect(
			await seraphimCxImageFormat.detect(
				sourceOf(buildCxFile({ packedSize: 0 })),
				"a.cts",
			),
		).toBe(false);
		expect(
			await seraphimCxImageFormat.detect(sourceOf(Buffer.alloc(8)), "a.cts"),
		).toBe(false);
	});

	it("turns a bottom up picture into a top down bitmap", async () => {
		const file = buildCxFile();
		const archive = await seraphimCxImageFormat.open(
			sourceOf(file),
			"CG01.cts",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
				offsetX: 4,
				offsetY: 9,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "seraphim-pixel-rle",
				width: 2,
				height: 2,
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([9, 10, 11, 12]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([13, 14, 15, 16]);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([1, 2, 3, 4]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([5, 6, 7, 8]);
	});

	it("copies a run of pixels from a row above", async () => {
		// Two pixels read as they stand, then an opcode that repeats the whole row of eight bytes.
		const file = buildCxFile({
			stream: Buffer.concat([
				literals([0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24]),
				Buffer.from([0x90, 7]),
			]),
		});
		const bmp = await extract(file);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([0x11, 0x12, 0x13, 0x14]);
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([0x21, 0x22, 0x23, 0x24]);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([0x11, 0x12, 0x13, 0x14]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([0x21, 0x22, 0x23, 0x24]);
	});

	it("counts a repeated run in whole pixels", async () => {
		// One pixel read as it stands, then an opcode that repeats it: its count is scaled by the four bytes of
		// a pixel, so a count of one writes one more pixel.
		const file = buildCxFile({
			stream: Buffer.concat([
				literals([0x31, 0x32, 0x33, 0x34]),
				Buffer.from([0xd0, 0x00, 0x02]),
			]),
		});
		const bmp = await extract(file);
		expect(pixelAt(bmp, 0, 1, 2)).toEqual([0x31, 0x32, 0x33, 0x34]);
		expect(pixelAt(bmp, 1, 1, 2)).toEqual([0x31, 0x32, 0x33, 0x34]);
		expect(pixelAt(bmp, 0, 0, 2)).toEqual([0x31, 0x32, 0x33, 0x34]);
	});

	it("stops a run that would reach past the picture", async () => {
		// The last pixel of the picture, then an opcode whose count would write five more of them.
		const file = buildCxFile({
			stream: Buffer.concat([
				literals([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]),
				Buffer.from([0xd0, 0x00, 0x06]),
			]),
		});
		const bmp = await extract(file);
		// The count is cut to the pixels that are left, so the picture stops where it ends.
		expect(pixelAt(bmp, 1, 0, 2)).toEqual([9, 10, 11, 12]);
	});

	it("stops on an opcode the reference does not know", async () => {
		const file = buildCxFile({
			stream: Buffer.concat([literals([1, 2, 3, 4]), Buffer.from([0xfd])]),
		});
		const archive = await seraphimCxImageFormat.open(
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
});
