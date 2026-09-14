import { BufferByteSource } from "@garbro-mcp/core";
import { fosterC25ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const FRAME_OFFSET = 0x20;
const PIXEL_OFFSET = 54;

interface C25Options {
	frames?: number;
	offsetX?: number;
	offsetY?: number;
}

/** An image whose frame sits past its header, with a table of row offsets behind it. */
function buildC25(
	width: number,
	height: number,
	rows: Buffer[],
	options: C25Options = {},
): Buffer {
	const tableSize = height * 4;
	const dataStart = FRAME_OFFSET + 16 + tableSize;
	const header: Buffer = Buffer.alloc(FRAME_OFFSET, 0x00);
	header.write("C25", 0, "latin1");
	header.writeInt32LE(options.frames ?? 1, 4);
	header.writeUInt32LE(FRAME_OFFSET, 8);
	const frame: Buffer = Buffer.alloc(16 + tableSize, 0x00);
	frame.writeUInt32LE(width, 0);
	frame.writeUInt32LE(height, 4);
	frame.writeInt32LE(options.offsetX ?? 0, 8);
	frame.writeInt32LE(options.offsetY ?? 0, 12);
	let at = dataStart;
	for (const [index, row] of rows.entries()) {
		frame.writeUInt32LE(at, 16 + index * 4);
		at += row.length;
	}
	return Buffer.concat([header, frame, ...rows]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await fosterC25ImageFormat.open(sourceOf(file), "image.c25");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("BeF game engine image", () => {
	it("finds its own word and not the one before it", async () => {
		expect(fosterC25ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x43, 0x32, 0x35, 0x00]) },
		]);
		const file = buildC25(1, 1, [Buffer.from([0x81, 1, 2, 3])]);
		expect(await fosterC25ImageFormat.detect(sourceOf(file), "image.c25")).toBe(
			true,
		);
		// The word of the twenty four bit kind of image is another format's, not this one's.
		const older = buildC25(1, 1, [Buffer.from([0x81, 1, 2, 3])]);
		older.write("C24", 0, "latin1");
		expect(
			await fosterC25ImageFormat.detect(sourceOf(older), "image.c25"),
		).toBe(false);
		expect(
			await fosterC25ImageFormat.detect(
				sourceOf(buildC25(1, 1, [Buffer.from([0x81, 1, 2, 3])], { frames: 0 })),
				"image.c25",
			),
		).toBe(false);
	});

	it("writes the pixels of a run of three bytes with an alpha byte behind each", async () => {
		// Two pixels taken from six bytes, each given an alpha byte of its own.
		const file = buildC25(2, 1, [Buffer.from([0x82, 1, 2, 3, 4, 5, 6])]);
		const archive = await fosterC25ImageFormat.open(
			sourceOf(file),
			"picture.c25",
		);
		try {
			expect(archive.entries[0]?.path).toBe("picture.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 2,
				height: 1,
				bitsPerPixel: 32,
			});
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "run-length",
				bitsPerPixel: 32,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(2);
		expect(bmp.readInt32LE(22)).toBe(-1);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 8)).toEqual(
			Buffer.from([1, 2, 3, 255, 4, 5, 6, 255]),
		);
	});

	it("keeps the alpha bytes of a run of four", async () => {
		// A count that much higher again asks for four bytes a pixel, which are written as they stand.
		const file = buildC25(1, 1, [Buffer.from([0xf1, 1, 2, 3, 4])]);
		const bmp = await render(file);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([1, 2, 3, 4]),
		);
	});

	it("leaves the pixels of a skipped run at nothing", async () => {
		// A run at or below 0x7F reads nothing and writes nothing: a skip of one pixel and then two written.
		const file = buildC25(3, 1, [Buffer.from([0x01, 0x82, 1, 2, 3, 4, 5, 6])]);
		const bmp = await render(file);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 12)).toEqual(
			Buffer.from([0, 0, 0, 0, 1, 2, 3, 255, 4, 5, 6, 255]),
		);
	});

	it("reads the counts of longer runs out of the word behind them", async () => {
		// A mark taken off to nothing means the count is a word: three bytes a pixel, four a pixel and a skip.
		const file = buildC25(5, 1, [
			Buffer.from([
				0x80,
				1,
				0,
				1,
				2,
				3, // one pixel of three bytes
				0xf0,
				1,
				0,
				4,
				5,
				6,
				7, // one pixel of four
				0x00,
				3,
				0, // three pixels skipped
			]),
		]);
		const bmp = await render(file);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 20)).toEqual(
			Buffer.from([
				1, 2, 3, 255, 4, 5, 6, 7, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
			]),
		);
	});

	it("lets a skipped run walk past the end of the image", async () => {
		// The last run of the last row skips more pixels than the image has, which writes nothing and is
		// therefore no error at all.
		const file = buildC25(1, 1, [Buffer.from([0x05])]);
		const bmp = await render(file);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0, 0, 0, 0]),
		);
	});

	it("stops with an error where the reference would", async () => {
		// A run of pixels that would be written past the end of the image.
		await expect(
			render(buildC25(1, 1, [Buffer.from([0x82, 1, 2, 3, 4, 5, 6])])),
		).rejects.toThrow(/Invalid BeF image run/);
		// A row whose offset is past the end of the file.
		const short = buildC25(1, 1, [Buffer.from([0x81, 1, 2, 3])]);
		short.writeUInt32LE(0xfff0, FRAME_OFFSET + 16);
		await expect(render(short)).rejects.toThrow(/Truncated BeF image row/);
		// A marked count with no word behind it.
		await expect(render(buildC25(1, 1, [Buffer.from([0x80])]))).rejects.toThrow(
			/Truncated BeF image run/,
		);
		// A row that stops before its width.
		await expect(
			render(buildC25(2, 1, [Buffer.from([0x81, 1, 2, 3])])),
		).rejects.toThrow(/Truncated BeF image row/);
	});
});
