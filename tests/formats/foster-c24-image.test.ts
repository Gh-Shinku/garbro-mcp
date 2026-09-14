import { BufferByteSource } from "@garbro-mcp/core";
import { fosterC24ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const FRAME_OFFSET = 0x20;
const PIXEL_OFFSET = 54;

interface C24Options {
	frames?: number;
	offsetX?: number;
	offsetY?: number;
	frameOffset?: number;
	width?: number;
	height?: number;
}

/** An image whose frame sits past its header, with a table of row offsets behind it. */
function buildC24(rows: Buffer[], options: C24Options = {}): Buffer {
	const frameOffset = options.frameOffset ?? FRAME_OFFSET;
	const height = options.height ?? rows.length;
	const tableSize = height * 4;
	const absolute = frameOffset === 0 ? FRAME_OFFSET : frameOffset;
	const dataStart = absolute + 16 + tableSize;
	const header: Buffer = Buffer.alloc(absolute, 0x00);
	header.write("C24", 0, "latin1");
	header.writeInt32LE(options.frames ?? 1, 4);
	header.writeUInt32LE(frameOffset, 8);
	const frame: Buffer = Buffer.alloc(16 + tableSize, 0x00);
	frame.writeUInt32LE(options.width ?? 0, 0);
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
	const archive = await fosterC24ImageFormat.open(sourceOf(file), "image.c24");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Foster game engine image", () => {
	it("finds its word and a count of frames above nothing", async () => {
		expect(fosterC24ImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x43, 0x32, 0x34, 0x00]) },
		]);
		const row = Buffer.from([0, 0]);
		const file = buildC24([row], { width: 1, height: 1 });
		expect(await fosterC24ImageFormat.detect(sourceOf(file), "image.c24")).toBe(
			true,
		);
		expect(
			await fosterC24ImageFormat.detect(
				sourceOf(buildC24([row], { width: 1, height: 1, frames: 0 })),
				"image.c24",
			),
		).toBe(false);
		expect(
			await fosterC24ImageFormat.detect(
				sourceOf(buildC24([row], { width: 0, height: 1 })),
				"image.c24",
			),
		).toBe(false);
		expect(
			await fosterC24ImageFormat.detect(
				sourceOf(Buffer.alloc(11, 0x00)),
				"image.c24",
			),
		).toBe(false);
		// A frame that would stand past the end of the file.
		const far = buildC24([row], { width: 1, height: 1 });
		far.writeUInt32LE(0x1000, 8);
		expect(await fosterC24ImageFormat.detect(sourceOf(far), "image.c24")).toBe(
			false,
		);
	});

	it("fills a run with white and copies the next one", async () => {
		// Four pixels: two filled and then two taken from the file.
		const row = Buffer.from([2, 2, 10, 11, 12, 13, 14, 15]);
		const file = buildC24([row], {
			width: 4,
			height: 1,
			offsetX: -3,
			offsetY: 7,
		});
		const archive = await fosterC24ImageFormat.open(
			sourceOf(file),
			"picture.c24",
		);
		try {
			expect(archive.entries[0]?.path).toBe("picture.bmp");
			expect(archive.entries[0]?.metadata).toMatchObject({
				width: 4,
				height: 1,
				bitsPerPixel: 24,
				offsetX: -3,
				offsetY: 7,
			});
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "run-length",
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(4);
		// The reference builds its rows top down.
		expect(bmp.readInt32LE(22)).toBe(-1);
		expect(bmp.readUInt16LE(28)).toBe(24);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 12)).toEqual(
			Buffer.from([255, 255, 255, 255, 255, 255, 10, 11, 12, 13, 14, 15]),
		);
	});

	it("reads a count marked out of the run it belongs to", async () => {
		// A fill marked with 0xFF and a copy marked with nothing: the marks are only their own.
		const row = Buffer.from([0xff, 2, 0, 0x00, 2, 0, 21, 22, 23, 24, 25, 26]);
		const file = buildC24([row], { width: 4, height: 1 });
		const bmp = await render(file);
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 12)).toEqual(
			Buffer.from([255, 255, 255, 255, 255, 255, 21, 22, 23, 24, 25, 26]),
		);
	});

	it("reads a copy of two hundred and fifty five pixels as it stands", async () => {
		// A count of 0xFF is a mark only in a fill, where a copy of it is the longest run of bytes a byte holds.
		const body: Buffer = Buffer.alloc(765, 0x00);
		for (let pixel = 0; pixel < 255; pixel += 1) {
			body[pixel * 3] = pixel;
		}
		const row = Buffer.concat([Buffer.from([0x00, 0xff]), body]);
		const file = buildC24([row], { width: 255, height: 1 });
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(255);
		// A row of seven hundred and sixty five bytes is padded to seven hundred and sixty eight.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 6)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x01, 0x00, 0x00]),
		);
		expect(bmp.subarray(PIXEL_OFFSET + 762, PIXEL_OFFSET + 768)).toEqual(
			Buffer.from([254, 0, 0, 0, 0, 0]),
		);
	});

	it("reads the rows by the offsets of its table", async () => {
		// Every row adds up to the width exactly, so each one lands on the row behind the one before it.
		const file = buildC24(
			[Buffer.from([1, 1, 31, 32, 33, 1, 1, 34, 35, 36]), Buffer.from([3])],
			{ width: 3, height: 2 },
		);
		const bmp = await render(file);
		expect(bmp.readUInt32LE(18)).toBe(3);
		expect(bmp.readInt32LE(22)).toBe(-2);
		// A row of three pixels is nine bytes, padded to twelve.
		expect(bmp.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 24)).toEqual(
			Buffer.from([
				255, 255, 255, 31, 32, 33, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255,
				255, 255, 255, 255, 255, 0, 0, 0,
			]),
		);
	});

	it("stops with an error where the reference would", async () => {
		// A run that would write past the whole image.
		await expect(
			render(buildC24([Buffer.from([3])], { width: 2, height: 1 })),
		).rejects.toThrow(/Invalid Foster image run/);
		await expect(
			render(buildC24([Buffer.from([1, 3, 1, 2, 3])], { width: 2, height: 1 })),
		).rejects.toThrow(/Invalid Foster image run/);
		// A row whose offset is past the end of the file.
		const short = buildC24([Buffer.from([3])], { width: 1, height: 1 });
		short.writeUInt32LE(0xfff0, FRAME_OFFSET + 16);
		await expect(render(short)).rejects.toThrow(/Truncated Foster image row/);
		// A row whose count is marked but has no word behind it.
		await expect(
			render(buildC24([Buffer.from([0xff])], { width: 1, height: 1 })),
		).rejects.toThrow(/Truncated Foster image run/);
		// A row that adds up to less than the width runs into the end of the file.
		await expect(
			render(buildC24([Buffer.from([1])], { width: 2, height: 1 })),
		).rejects.toThrow(/Truncated Foster image row/);
	});
});
