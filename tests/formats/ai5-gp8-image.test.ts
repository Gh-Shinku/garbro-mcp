import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { ai5Gp8ImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 8;
const PALETTE_ENTRIES = 0x100;
const PALETTE_BYTES = PALETTE_ENTRIES * 4;
const BMP_HEADER_SIZE = 54;
/** An eight bit bitmap carries its palette right behind its header, a thousand and twenty four bytes of it. */
const BMP_PIXELS_OFFSET = BMP_HEADER_SIZE + PALETTE_BYTES;

/** One control byte per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

interface Gp8Options {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	pixels?: Buffer;
	palette?: [number, number, number, number][];
	stream?: Buffer;
}

function buildGp8(options: Gp8Options = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	const palette: Buffer = Buffer.alloc(PALETTE_BYTES, 0x00);
	for (const [index, entry] of (options.palette ?? []).entries()) {
		entry.forEach((byte, i) => {
			palette[index * 4 + i] = byte;
		});
	}
	header.writeInt16LE(options.offsetX ?? 0, 0);
	header.writeInt16LE(options.offsetY ?? 0, 2);
	header.writeInt16LE(options.width ?? 2, 4);
	header.writeInt16LE(options.height ?? 1, 6);
	const stream =
		options.stream ?? lzssLiterals(options.pixels ?? Buffer.alloc(2, 0));
	return Buffer.concat([header, palette, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer): Promise<Buffer> {
	const archive = await ai5Gp8ImageFormat.open(sourceOf(file), "CG01.gp8");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Ai5 engine indexed image (GP8)", () => {
	it("declares no word and no extension", () => {
		expect(ai5Gp8ImageFormat.detection?.signatures).toEqual([]);
		expect(ai5Gp8ImageFormat.descriptor.extensions).toEqual([]);
	});

	it("holds its measurements and its positions to what the reference allows", async () => {
		expect(await ai5Gp8ImageFormat.detect(sourceOf(buildGp8()), "a.gp8")).toBe(
			true,
		);
		// The file has to be longer than its palette, not as long as it.
		expect(
			await ai5Gp8ImageFormat.detect(sourceOf(Buffer.alloc(0x408, 0)), "a.gp8"),
		).toBe(false);
		expect(
			await ai5Gp8ImageFormat.detect(
				sourceOf(buildGp8({ offsetX: 0x300, offsetY: 0x300 })),
				"a.gp8",
			),
		).toBe(true);
		// The indexed kind allows its picture no further than three hundred from the beginning.
		expect(
			await ai5Gp8ImageFormat.detect(
				sourceOf(buildGp8({ offsetX: 0x301 })),
				"a.gp8",
			),
		).toBe(false);
		expect(
			await ai5Gp8ImageFormat.detect(
				sourceOf(buildGp8({ offsetY: -1 })),
				"a.gp8",
			),
		).toBe(false);
		expect(
			await ai5Gp8ImageFormat.detect(sourceOf(buildGp8({ width: 0 })), "a.gp8"),
		).toBe(false);
		expect(
			await ai5Gp8ImageFormat.detect(
				sourceOf(buildGp8({ width: 0x1001 })),
				"a.gp8",
			),
		).toBe(false);
		expect(
			await ai5Gp8ImageFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE, 0)),
				"a.gp8",
			),
		).toBe(false);
	});

	it("takes the palette in front of the picture and drops its fourth byte", async () => {
		const file = buildGp8({
			width: 2,
			height: 2,
			palette: [
				[0x10, 0x20, 0x30, 0x40],
				[0x11, 0x22, 0x33, 0x44],
			],
			pixels: Buffer.from([0, 1, 1, 0]),
		});
		const archive = await ai5Gp8ImageFormat.open(sourceOf(file), "CG01.gp8");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["CG01.bmp"]);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 2,
				height: 2,
				bitsPerPixel: 8,
			});
			// The reference makes a colour of the first three bytes and drops the fourth; it also keeps no
			// position of the picture in its measurements.
			expect(archive.entries[0]?.metadata).not.toHaveProperty("offsetX");
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "lzss",
				width: 2,
				height: 2,
				bitsPerPixel: 8,
			});
		} finally {
			await archive.close();
		}
		const bmp = await extract(file);
		expect(bmp.readUInt16LE(28)).toBe(8);
		expect(bmp.readUInt32LE(46)).toBe(PALETTE_ENTRIES);
		// `ImageData.CreateFlipped` stores the rows bottom up, which a bitmap records with a positive height.
		expect(bmp.readInt32LE(22)).toBe(2);
		expect(bmp.subarray(BMP_HEADER_SIZE, BMP_HEADER_SIZE + 8)).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0x00, 0x11, 0x22, 0x33, 0x00]),
		);
		// The pixels follow the whole palette, aligned to four bytes a row.
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 8)).toEqual(
			Buffer.from([0x00, 0x01, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00]),
		);
	});

	it("stops when the stream carries less than the whole picture", async () => {
		const file = buildGp8({
			width: 2,
			height: 2,
			stream: lzssLiterals(Buffer.from([1, 2, 3])),
		});
		const archive = await ai5Gp8ImageFormat.open(sourceOf(file), "CG01.gp8");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			await expect(archive.openEntry(entry.id)).rejects.toThrow(GarbroError);
			await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
				code: "INVALID_ARCHIVE",
				message: "Truncated Ai5 image pixels",
			});
		} finally {
			await archive.close();
		}
	});

	it("reads past the end of the stream without minding what follows it", async () => {
		// The stream holds the whole picture, so whatever the file carries behind it is never read.
		const file = Buffer.concat([
			buildGp8({ width: 1, height: 1, pixels: Buffer.from([7]) }),
			Buffer.from([0xaa, 0xbb]),
		]);
		expect(await ai5Gp8ImageFormat.detect(sourceOf(file), "a.gp8")).toBe(true);
		const bmp = await extract(file);
		expect(bmp.subarray(BMP_PIXELS_OFFSET, BMP_PIXELS_OFFSET + 4)).toEqual(
			Buffer.from([7, 0x00, 0x00, 0x00]),
		);
	});
});
