import { BufferByteSource } from "@garbro-mcp/core";
import { gpdImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const PALETTE_SIZE = 1024;
const PIXEL_OFFSET = 54 + PALETTE_SIZE;
const RAW = -1;

interface GpdOptions {
	width?: number;
	height?: number;
	colors?: number;
	bitsPerPixel?: number;
	marker?: string;
	headerSize?: number;
	/** The palette entries, four bytes each, as the reference's own colour map reads them. */
	palette?: Buffer;
	/** The stored pixels. */
	body?: Buffer;
	/** How the body is marked up: minus one means it follows as it is. */
	packedSize?: number;
}

function buildGpd(options: GpdOptions = {}): Buffer {
	const header: Buffer = Buffer.alloc(options.headerSize ?? HEADER_SIZE, 0x00);
	header.write(options.marker ?? "GPD ", 0, "latin1");
	if (header.length >= HEADER_SIZE) {
		header.writeUInt32LE(options.width ?? 2, 8);
		header.writeUInt32LE(options.height ?? 1, 0x0c);
		header.writeInt32LE(options.colors ?? 0, 0x10);
		header.writeInt32LE(options.bitsPerPixel ?? 24, 0x14);
	}
	const parts: Buffer[] = [header];
	if (options.palette) parts.push(options.palette);
	const packed: Buffer = Buffer.alloc(4);
	packed.writeInt32LE(options.packedSize ?? RAW, 0);
	parts.push(packed, options.body ?? Buffer.alloc(0));
	return Buffer.concat(parts);
}

/**
 * A compressed stream of literals: one control byte whose bits are all set, then the bytes themselves. The
 * helper the port needs only ever reads as many bytes as the image holds.
 */
function lzssLiterals(bytes: number[]): Buffer {
	return Buffer.from([0xff, ...bytes]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.gpd"): Promise<Buffer> {
	const archive = await gpdImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("An*tique image", () => {
	it("takes any file the marker starts, and refuses a depth it cannot read", async () => {
		expect(await gpdImageFormat.detect(sourceOf(buildGpd()), "A.gpd")).toBe(
			true,
		);
		expect(
			await gpdImageFormat.detect(
				sourceOf(buildGpd({ marker: "GPDX" })),
				"A.gpd",
			),
		).toBe(false);
		// The header has twenty four bytes; a file one byte short of that is not read at all. The builder's own
		// trailing size word would push a short header back over the line, so this one is built by hand.
		const stub: Buffer = Buffer.concat([
			Buffer.from("GPD ", "latin1"),
			Buffer.alloc(19, 0x00),
		]);
		expect(stub.length).toBe(0x17);
		expect(await gpdImageFormat.detect(sourceOf(stub), "A.gpd")).toBe(false);
		// The header is read without checks, so a depth the reading code will refuse is still detected.
		const odd = buildGpd({ bitsPerPixel: 16 });
		expect(await gpdImageFormat.detect(sourceOf(odd), "A.gpd")).toBe(true);
		await expect(extract(odd)).rejects.toThrow();
		for (const bitsPerPixel of [1, 15, -8, 64]) {
			await expect(extract(buildGpd({ bitsPerPixel }))).rejects.toThrow();
		}
	});

	it("hands the header's own fields out unaltered", async () => {
		const archive = await gpdImageFormat.open(
			sourceOf(buildGpd({ width: 11, height: 6, colors: 7, bitsPerPixel: 16 })),
			"A.gpd",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 11,
				height: 6,
				bitsPerPixel: 16,
			});
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				width: 11,
				height: 6,
			});
		} finally {
			await archive.close();
		}
	});

	it("reads pixels that follow as they are when the size word says minus one", async () => {
		const body: Buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const output = await extract(buildGpd({ width: 2, height: 1, body }));
		expect(output.readUInt16LE(28)).toBe(24);
		// The reference hands this image over flipped.
		expect(output.readInt32LE(22)).toBe(1);
		// Six bytes of colour in a row that a bitmap pads to eight.
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00]),
		);
	});

	it("reads the same pixels through the compressor", async () => {
		const body: Buffer = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const output = await extract(
			buildGpd({
				width: 2,
				height: 1,
				packedSize: 7,
				body: lzssLiterals([...body]),
			}),
		);
		expect(output.readInt32LE(22)).toBe(1);
		expect(output.subarray(54)).toEqual(
			Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x00, 0x00]),
		);
	});

	it("reads thirty two bit pixels four bytes at a time", async () => {
		const body: Buffer = Buffer.from([0xaa, 0xbb, 0xcc, 0xdd]);
		const output = await extract(
			buildGpd({ width: 1, height: 1, bitsPerPixel: 32, body }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54)).toEqual(body);
	});

	it("reads an eight bit image with the palette its header describes", async () => {
		const palette: Buffer = Buffer.from([
			0x10, 0x20, 0x30, 0x00, 0x40, 0x50, 0x60, 0x00,
		]);
		const body: Buffer = Buffer.from([0x01, 0x00]);
		const output = await extract(
			buildGpd({
				width: 2,
				height: 1,
				colors: 2,
				bitsPerPixel: 8,
				palette,
				body,
			}),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		// The palette area is a full page with the header's entries at its front and the rest blank.
		expect(output.readUInt32LE(10)).toBe(PIXEL_OFFSET);
		expect(output.subarray(54, 62)).toEqual(palette);
		expect(
			output
				.subarray(62, PIXEL_OFFSET)
				.equals(Buffer.alloc(PIXEL_OFFSET - 62, 0x00)),
		).toBe(true);
		// Two pixels in a row that a bitmap pads to four.
		expect(output.subarray(PIXEL_OFFSET)).toEqual(
			Buffer.from([0x01, 0x00, 0x00, 0x00]),
		);
	});

	it("reads a palette the header leaves empty, rather than assuming a full one", async () => {
		// Unlike the other reader that takes a colour count, this one has no default of its own.
		const body: Buffer = Buffer.from([0x00, 0x01]);
		const output = await extract(
			buildGpd({ width: 2, height: 1, colors: 0, bitsPerPixel: 8, body }),
		);
		expect(
			output
				.subarray(54, PIXEL_OFFSET)
				.equals(Buffer.alloc(PALETTE_SIZE, 0x00)),
		).toBe(true);
		expect(output.subarray(PIXEL_OFFSET)).toEqual(
			Buffer.from([0x00, 0x01, 0x00, 0x00]),
		);
	});

	it("names the entry after the bitmap and reports its depth", async () => {
		const archive = await gpdImageFormat.open(
			sourceOf(buildGpd({ width: 3, height: 2 })),
			"sub/CG_12.gpd",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_12.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
		} finally {
			await archive.close();
		}
	});
});
