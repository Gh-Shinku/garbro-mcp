import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { mixwillPb00ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

/** A run writing each of its pixels as it stands. */
function literal(values: number[]): number[] {
	return [values.length - 1, ...values];
}

/**
 * A run writing one value over and over. The count is one more than the negative byte that names it, the same
 * way a run of the other kind counts one more than its opcode.
 */
function repeat(count: number, value: number): number[] {
	return [(256 - (count - 1)) & 0xff, value];
}

interface Pb00Fixture {
	width: number;
	height: number;
	bitsPerPixel: number;
	/** The streams of the channels, and the length the table gives for each of them. */
	channels: { bytes: number[]; length?: number }[];
}

function buildPb00(fixture: Pb00Fixture): Buffer {
	const header = Buffer.alloc(0x20, 0x00);
	header.write("PB00", 0, "latin1");
	header.writeInt32LE(fixture.bitsPerPixel / 8, 4);
	header.writeUInt32LE(fixture.width, 8);
	header.writeUInt32LE(fixture.height, 0xc);
	const body: number[] = [];
	for (let i = 0; i < 4; i += 1) {
		const channel = fixture.channels[i];
		if (!channel) {
			header.writeInt32LE(0, 0x10 + i * 4);
			continue;
		}
		header.writeInt32LE(channel.length ?? channel.bytes.length, 0x10 + i * 4);
		body.push(...channel.bytes);
	}
	return Buffer.concat([header, Buffer.from(body)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await mixwillPb00ImageFormat.open(sourceOf(file), "CG01.PB");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

/** The pixels of a bitmap, without its header. Row padding included. */
function pixelsOf(bmp: Buffer): Buffer {
	return bmp.subarray(54);
}

/** The three bytes of one pixel of a bitmap of three byte pixels. */
function pixelAt(bmp: Buffer, x: number, y: number, width: number): Buffer {
	const rowSize = Math.ceil((width * 3) / 4) * 4;
	const start = 54 + y * rowSize + x * 3;
	return bmp.subarray(start, start + 3);
}

describe("Mixwill PB00 image", () => {
	it("finds its files by its word and a header", async () => {
		const file = buildPb00({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			channels: [{ bytes: literal([1, 2, 3, 4]) }],
		});
		expect(await mixwillPb00ImageFormat.detect(sourceOf(file), "a.pb")).toBe(
			true,
		);
		expect(
			await mixwillPb00ImageFormat.detect(
				sourceOf(Buffer.from("PB01", "latin1")),
				"a.pb",
			),
		).toBe(false);
		expect(
			await mixwillPb00ImageFormat.detect(
				sourceOf(Buffer.alloc(0x10, 0)),
				"a.pb",
			),
		).toBe(false);
		// A picture of no width is no picture.
		const empty = buildPb00({
			width: 0,
			height: 2,
			bitsPerPixel: 24,
			channels: [],
		});
		expect(await mixwillPb00ImageFormat.detect(sourceOf(empty), "a.pb")).toBe(
			false,
		);
	});

	it("lays every channel into its own byte of a pixel", async () => {
		const file = buildPb00({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			channels: [
				{ bytes: literal([0x01, 0x02, 0x03, 0x04]) },
				{ bytes: literal([0x11, 0x12, 0x13, 0x14]) },
				{ bytes: literal([0x21, 0x22, 0x23, 0x24]) },
			],
		});
		const archive = await mixwillPb00ImageFormat.open(
			sourceOf(file),
			"CG01.PB",
		);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
				channels: 3,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "run-length",
				width: 2,
				height: 2,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
		const bmp = await render(file);
		// The rows are stored top down, so the height is negative in the bitmap header.
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(bmp.readUInt16LE(28)).toBe(24);
		// The file writes blue first, so the channels are read in blue, green, red order.
		expect(pixelsOf(bmp)).toEqual(
			Buffer.from([
				0x21, 0x11, 0x01, 0x22, 0x12, 0x02, 0x00, 0x00, 0x23, 0x13, 0x03, 0x24,
				0x14, 0x04, 0x00, 0x00,
			]),
		);
	});

	it("keeps the counter of a stream counting bytes rather than runs", async () => {
		// The stream of the first channel is two bytes of a run of five, and the table says three, which is
		// what two bytes of a run of five do **not** take: the counter moves by one for the run and one for
		// the opcode, so the reader takes a third step and reads the byte behind the stream as an opcode of
		// its own. That stray run then goes on with the bytes of the next channel's stream, which begins at
		// the length the table gives rather than where the stream really ended.
		const file = buildPb00({
			width: 2,
			height: 4,
			bitsPerPixel: 24,
			channels: [
				{
					bytes: [...repeat(5, 0x33), ...literal([0x01, 0x55, 0x66])],
					length: 3,
				},
				{ bytes: literal([0x55, 0x66]) },
			],
		});
		const bmp = await render(file);
		// The run of five pixels fills the blue byte of the first five pixels.
		expect(pixelAt(bmp, 0, 0, 2)).toEqual(Buffer.from([0x00, 0x55, 0x33]));
		expect(pixelAt(bmp, 1, 0, 2)).toEqual(Buffer.from([0x00, 0x66, 0x33]));
		expect(pixelAt(bmp, 0, 1, 2)).toEqual(Buffer.from([0x00, 0x00, 0x33]));
		expect(pixelAt(bmp, 1, 1, 2)).toEqual(Buffer.from([0x00, 0x00, 0x33]));
		expect(pixelAt(bmp, 0, 2, 2)).toEqual(Buffer.from([0x00, 0x00, 0x33]));
		// The stray run goes on where the run left the blue byte: the next three pixels.
		expect(pixelAt(bmp, 1, 2, 2)).toEqual(Buffer.from([0x00, 0x00, 0x01]));
		expect(pixelAt(bmp, 0, 3, 2)).toEqual(Buffer.from([0x00, 0x00, 0x55]));
		expect(pixelAt(bmp, 1, 3, 2)).toEqual(Buffer.from([0x00, 0x00, 0x66]));
	});

	it("writes the alpha channel of a picture of four channels", async () => {
		const file = buildPb00({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			channels: [
				{ bytes: literal([0x01, 0x02, 0x03, 0x04]) },
				{ bytes: literal([0x11, 0x12, 0x13, 0x14]) },
				{ bytes: literal([0x21, 0x22, 0x23, 0x24]) },
				{ bytes: literal([0x31, 0x32, 0x33, 0x34]) },
			],
		});
		const bmp = await render(file);
		expect(bmp.readInt32LE(22)).toBe(-2);
		expect(bmp.readUInt16LE(28)).toBe(32);
		expect(pixelsOf(bmp)).toEqual(
			Buffer.from([
				0x21, 0x11, 0x01, 0x31, 0x22, 0x12, 0x02, 0x32, 0x23, 0x13, 0x03, 0x33,
				0x24, 0x14, 0x04, 0x34,
			]),
		);
	});

	it("refuses a depth whose channels do not fill a pixel", async () => {
		const file = buildPb00({
			width: 2,
			height: 2,
			bitsPerPixel: 16,
			channels: [{ bytes: literal([1, 2, 3, 4]) }],
		});
		expect(await mixwillPb00ImageFormat.detect(sourceOf(file), "a.pb")).toBe(
			true,
		);
		const archive = await mixwillPb00ImageFormat.open(sourceOf(file), "a.pb");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		} finally {
			await archive.close();
		}
	});

	it("stops when a run walks out of the picture", async () => {
		const file = buildPb00({
			width: 1,
			height: 1,
			bitsPerPixel: 24,
			channels: [{ bytes: literal([1, 2, 3, 4, 5]) }],
		});
		const archive = await mixwillPb00ImageFormat.open(sourceOf(file), "a.pb");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Pixel run past the image",
			});
		} finally {
			await archive.close();
		}
	});
});
