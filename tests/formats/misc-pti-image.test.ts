import { BufferByteSource } from "@garbro-mcp/core";
import { ptiImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const DIB_OFFSET = 0x10;
const HEADER_SIZE = 0x38;
const BMP_HEADER_SIZE = 54;

interface Fields {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	/** Overrides the zero word at 0x0E, which has to be zero. */
	zeroWord?: number;
	/** Overrides the device independent header size at 0x10. */
	dibSize?: number;
}

/** A device independent header plus its pixels, without the two byte shift a pti file has. */
function buildBmp(fields: Fields, pixels: Buffer): Buffer {
	const width = fields.width ?? 2;
	const height = fields.height ?? 2;
	const bitsPerPixel = fields.bitsPerPixel ?? 24;
	const header: Buffer = Buffer.alloc(BMP_HEADER_SIZE, 0x00);
	header.write("BM", 0, "latin1");
	header.writeUInt32LE(BMP_HEADER_SIZE + pixels.length, 2);
	header.writeUInt32LE(BMP_HEADER_SIZE, 10);
	header.writeUInt32LE(40, 14);
	header.writeInt32LE(width, 18);
	header.writeInt32LE(height, 22);
	header.writeUInt16LE(1, 26);
	header.writeUInt16LE(bitsPerPixel, 28);
	header.writeUInt32LE(0, 30);
	header.writeUInt32LE(pixels.length, 34);
	return Buffer.concat([header, pixels]);
}

/** The same thing with the pti file's layout: a zero word where the header would start, then the header. */
function buildPti(fields: Fields, pixels: Buffer): Buffer {
	const bmp = buildBmp(fields, pixels);
	const width = fields.width ?? 2;
	const height = fields.height ?? 2;
	const bitsPerPixel = fields.bitsPerPixel ?? 24;
	const stored: Buffer = Buffer.alloc(HEADER_SIZE + pixels.length, 0x00);
	bmp.copy(stored, 0, 0, 14);
	stored.writeUInt16LE(fields.zeroWord ?? 0, 0x0e);
	stored.writeUInt32LE(fields.dibSize ?? 40, DIB_OFFSET);
	stored.writeInt32LE(width, DIB_OFFSET + 4);
	stored.writeInt32LE(height, DIB_OFFSET + 8);
	stored.writeUInt16LE(1, DIB_OFFSET + 12);
	stored.writeUInt16LE(bitsPerPixel, DIB_OFFSET + 14);
	stored.writeUInt32LE(0, DIB_OFFSET + 16);
	stored.writeUInt32LE(pixels.length, DIB_OFFSET + 20);
	pixels.copy(stored, HEADER_SIZE);
	return stored;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "IMAGE.PTI"): Promise<Buffer> {
	const archive = await ptiImageFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("misc pti image", () => {
	it("registers no signature and no extension", () => {
		expect(ptiImageFormat.detection?.signatures ?? []).toEqual([]);
		expect(ptiImageFormat.descriptor.extensions).toEqual([]);
	});

	it("moves the header two bytes earlier and hands back a bitmap", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x00, 0x00, 0x21, 0x22, 0x23, 0x31,
			0x32, 0x33, 0x00, 0x00,
		]);
		const stored = buildPti({}, pixels);
		const source = sourceOf(stored);
		expect(await ptiImageFormat.detect(source, "IMAGE.PTI")).toBe(true);
		const archive = await ptiImageFormat.open(source, "IMAGE.PTI");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["IMAGE.bmp"]);
			// The two reads move bytes in place, so the bitmap is exactly as long as the stored file.
			expect(archive.entries[0]?.sizeKnown).toBe(true);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 2,
				height: 2,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		// The pixels move with the header, so they land exactly at the bitmap's pixel offset; the two bytes
		// the buffer has left over stay zero and the size word names two bytes fewer than the buffer holds.
		expect(output.length).toBe(stored.length);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.concat([pixels, Buffer.alloc(2, 0x00)]),
		);
		expect(output.readUInt32LE(2)).toBe(output.length - 2);
		expect(output.readUInt32LE(10)).toBe(BMP_HEADER_SIZE);
	});

	it("declines an ordinary bitmap, which has its header where the zero word belongs", async () => {
		// This format is a bitmap with two bytes inserted; a plain bitmap fails the zero word check because
		// the word at 0x0E is the start of its own header.
		const plain = buildBmp({}, Buffer.alloc(16, 0x11));
		expect(plain.readUInt16LE(0x0e)).toBe(40);
		expect(await ptiImageFormat.detect(sourceOf(plain), "IMAGE.PTI")).toBe(
			false,
		);
		const stored = buildPti({}, Buffer.alloc(16, 0x11));
		expect(await ptiImageFormat.detect(sourceOf(stored), "IMAGE.PTI")).toBe(
			true,
		);
	});

	it("declines a non zero word at 0x0E and a wrong header size", async () => {
		const pixels = Buffer.alloc(16, 0x11);
		const zeroWord = buildPti({ zeroWord: 1 }, pixels);
		expect(await ptiImageFormat.detect(sourceOf(zeroWord), "IMAGE.PTI")).toBe(
			false,
		);
		const dib = buildPti({ dibSize: 12 }, pixels);
		expect(await ptiImageFormat.detect(sourceOf(dib), "IMAGE.PTI")).toBe(false);
	});

	it("replaces the last two bytes of a short twenty four bit image", async () => {
		// Two by two at three bytes a pixel is twelve; the file stores ten, and the reference's condition
		// fires, writing its marker over the final two bytes of the pixel data.
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x11, 0x12, 0x13, 0x21, 0x22, 0x23, 0x31,
		]);
		expect(pixels.length).toBe(10);
		const stored = buildPti({}, pixels);
		const output = await extract(stored);
		expect(output.length).toBe(stored.length);
		// Every stored pixel survives, because the two bytes the marker replaces are the two the buffer left
		// over rather than any of the pixels; and adding two to the length makes the size word name the whole
		// buffer, which is why this case ends up agreeing with itself.
		expect(output.subarray(BMP_HEADER_SIZE, output.length - 2)).toEqual(pixels);
		expect(output.subarray(output.length - 2)).toEqual(
			Buffer.from([0xff, 0xff]),
		);
		expect(output.readUInt32LE(2)).toBe(output.length);
	});

	it("leaves a thirty two bit image alone", async () => {
		const pixels = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x11, 0x12, 0x13, 0x14, 0x21, 0x22, 0x23, 0x24,
			0x31, 0x32, 0x33, 0x34,
		]);
		const stored = buildPti({ bitsPerPixel: 32 }, pixels);
		const output = await extract(stored);
		expect(output.subarray(BMP_HEADER_SIZE)).toEqual(
			Buffer.concat([pixels, Buffer.alloc(2, 0x00)]),
		);
		expect(output.readUInt16LE(28)).toBe(32);
	});

	it("declines zero dimensions and a short file", async () => {
		const zero = buildPti({ width: 0 }, Buffer.alloc(16, 0x11));
		expect(await ptiImageFormat.detect(sourceOf(zero), "IMAGE.PTI")).toBe(
			false,
		);
		expect(
			await ptiImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"IMAGE.PTI",
			),
		).toBe(false);
	});
});
