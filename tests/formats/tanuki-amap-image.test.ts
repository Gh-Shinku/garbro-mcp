import { BufferByteSource } from "@garbro-mcp/core";
import { tanukiAmapImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER_SIZE = 0x14;
const PALETTE_PAGE = 0x100 * 4;
const PIXEL_OFFSET = 54 + PALETTE_PAGE;

interface AmapOptions {
	width?: number;
	height?: number;
	/** The pixels before compression. */
	pixels?: Buffer;
	/** Replaces the compressed body outright. */
	stream?: Buffer;
	/** What the header claims the unpacked length is. */
	unpackedSize?: number;
	marker?: string;
}

function buildAmap(options: AmapOptions = {}): Buffer {
	const width = options.width ?? 3;
	const height = options.height ?? 2;
	const pixels =
		options.pixels ??
		Buffer.from(
			Array.from({ length: width * height }, (_, index) => index * 17),
		);
	const stream = options.stream ?? literalLzssStream(pixels);
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	header.write(options.marker ?? "AMAP", 0, "latin1");
	header.writeUInt16LE(width, 4);
	header.writeUInt16LE(height, 6);
	header.writeInt32LE(options.unpackedSize ?? pixels.length, 0x10);
	return Buffer.concat([header, stream]);
}

/**
 * One literal token then one match. A **set** control bit means a literal and a clear one means a match, so
 * the byte below has bit zero set and bit one clear.
 */
function literalThenMatch(
	literal: number,
	offset: number,
	count: number,
): Buffer {
	const control = 0b00000001;
	const hi = (((offset >> 8) & 0xf) << 4) | (0x0f & ~(count - 3));
	// The pair is stored low byte first, whatever the offset looks like in memory.
	return Buffer.from([control, literal, offset & 0xff, hi]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.af"): Promise<Buffer> {
	const archive = await tanukiAmapImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("TanukiSoft bitmap", () => {
	it("needs its marker, a whole header and a length that can hold the image", async () => {
		expect(
			await tanukiAmapImageFormat.detect(sourceOf(buildAmap()), "A.af"),
		).toBe(true);
		// A length shorter than the image the header describes fails where the reference's image layer does.
		expect(
			await tanukiAmapImageFormat.detect(
				sourceOf(buildAmap({ width: 4, height: 4, unpackedSize: 8 })),
				"A.af",
			),
		).toBe(false);
		expect(
			await tanukiAmapImageFormat.detect(
				sourceOf(buildAmap({ unpackedSize: 0 })),
				"A.af",
			),
		).toBe(false);
		expect(
			await tanukiAmapImageFormat.detect(
				sourceOf(buildAmap({ marker: "AMAQ" })),
				"A.af",
			),
		).toBe(false);
		expect(
			await tanukiAmapImageFormat.detect(
				sourceOf(Buffer.from("AMAP", "latin1")),
				"A.af",
			),
		).toBe(false);
	});

	it("describes an eight bit image and its extension", async () => {
		const archive = await tanukiAmapImageFormat.open(
			sourceOf(buildAmap({ width: 5, height: 3 })),
			"A.af",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 3,
				bitsPerPixel: 8,
			});
			expect(tanukiAmapImageFormat.descriptor.extensions).toEqual(["af"]);
		} finally {
			await archive.close();
		}
	});

	it("unwraps literals into a grey bitmap", async () => {
		const pixels = Buffer.from([0x00, 0x40, 0x80, 0xc0, 0xff, 0x7f]);
		const output = await extract(buildAmap({ width: 3, height: 2, pixels }));
		expect(output.readUInt16LE(28)).toBe(8);
		// This reader does not flip, so the bitmap's height is negative.
		expect(output.readInt32LE(22)).toBe(-2);
		// The palette page is the grey ramp and the pixels follow it, a row at a time and padded to four.
		expect(output.subarray(54 + 0x40 * 4, 54 + 0x40 * 4 + 4)).toEqual(
			Buffer.from([0x40, 0x40, 0x40, 0x00]),
		);
		expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([0x00, 0x40, 0x80, 0x00]),
		);
		expect(output.subarray(PIXEL_OFFSET + 4, PIXEL_OFFSET + 8)).toEqual(
			Buffer.from([0xc0, 0xff, 0x7f, 0x00]),
		);
	});

	it("repeats the window a match points at", async () => {
		// The window starts at 0xFEE, so the byte just written is at that offset.
		const stream = literalThenMatch(0x41, 0xfee, 4);
		const output = await extract(
			buildAmap({ width: 5, height: 1, stream, unpackedSize: 5 }),
		);
		expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 5)).toEqual(
			Buffer.from([0x41, 0x41, 0x41, 0x41, 0x41]),
		);
	});

	it("copies a run out of the window as it writes", async () => {
		// Three literals, then a match of five bytes pointing at the first of them. The bytes the match
		// reads are the ones it has already written, so the three colours cycle.
		const stream = Buffer.concat([
			Buffer.from([0b00000111, 0x10, 0x20, 0x30]),
			Buffer.from([0xee, 0xfd]),
		]);
		const output = await extract(
			buildAmap({ width: 8, height: 1, stream, unpackedSize: 8 }),
		);
		expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 8)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0x10, 0x20, 0x30, 0x10, 0x20]),
		);
	});

	it("keeps only as much of the stream as the image holds", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		// The header promises more than the image needs, which the reference's image layer ignores.
		const output = await extract(
			buildAmap({ width: 2, height: 2, pixels, unpackedSize: pixels.length }),
		);
		expect(output.readInt32LE(22)).toBe(-2);
		expect(output.subarray(PIXEL_OFFSET, PIXEL_OFFSET + 4)).toEqual(
			Buffer.from([1, 2, 0, 0]),
		);
	});

	it("names the entry after the bitmap", async () => {
		const archive = await tanukiAmapImageFormat.open(
			sourceOf(buildAmap({ width: 4, height: 4 })),
			"sub/CG_07.af",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
