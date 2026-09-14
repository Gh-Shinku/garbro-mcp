import { BufferByteSource } from "@garbro-mcp/core";
import { interheartEpfImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SHORT_HEADER_SIZE = 10;
const LONG_HEADER_SIZE = 14;

interface HeaderOptions {
	width: number;
	height: number;
	bitsPerPixel: number;
	version?: number;
	colors?: number;
	offsetX?: number;
	offsetY?: number;
	/** Forces a header size the reference does not know. */
	headerSize?: number;
	short?: boolean;
}

function buildHeader(options: HeaderOptions): Buffer {
	const headerSize =
		options.headerSize ??
		(options.short ? SHORT_HEADER_SIZE : LONG_HEADER_SIZE);
	const header: Buffer = Buffer.alloc(LONG_HEADER_SIZE, 0x00);
	header.writeUInt16BE(headerSize, 0);
	const version = options.version ?? 1;
	const colors = options.colors ?? 0;
	if (options.short) {
		header.writeUInt16BE(options.width, 2);
		header.writeUInt16BE(options.height, 4);
		header[6] = options.bitsPerPixel;
		header[7] = version;
		header.writeUInt16BE(colors, 8);
		return header.subarray(0, SHORT_HEADER_SIZE);
	}
	header.writeInt16BE(options.offsetX ?? 0, 2);
	header.writeInt16BE(options.offsetY ?? 0, 4);
	header.writeUInt16BE(options.width, 6);
	header.writeUInt16BE(options.height, 8);
	header[0x0a] = options.bitsPerPixel;
	header[0x0b] = version;
	header.writeUInt16BE(colors, 0x0c);
	return header;
}

/** Palette entries as the file stores them: four bytes whose first is dropped, then red, green and blue. */
function buildPalette(entries: Array<[number, number, number]>): Buffer {
	const palette: Buffer = Buffer.alloc(entries.length * 4, 0x00);
	entries.forEach(([red, green, blue], index) => {
		palette[index * 4 + 1] = red;
		palette[index * 4 + 2] = green;
		palette[index * 4 + 3] = blue;
	});
	return palette;
}

function buildEpf(
	options: HeaderOptions,
	palette: Buffer,
	coded: Buffer,
): Buffer {
	return Buffer.concat([buildHeader(options), palette, coded]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG01.bin"): Promise<Buffer> {
	const archive = await interheartEpfImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("Candy Soft image", () => {
	it("declares its two words and takes a sound header from any name", async () => {
		expect(interheartEpfImageFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x00, 0x0e]) },
			{ bytes: Buffer.from([0x00, 0x0a, 0x02, 0x80]) },
		]);
		expect(interheartEpfImageFormat.descriptor.extensions).toEqual([]);
		// The fourteen byte form is a registered word, the ten byte one only when its width is 0x280; both are
		// still taken, because the reference offers every remaining file to it.
		const long = buildEpf(
			{ width: 5, height: 1, bitsPerPixel: 8, colors: 0 },
			Buffer.alloc(0),
			Buffer.from([0x1f, 1, 2, 3, 4, 5]),
		);
		expect(
			await interheartEpfImageFormat.detect(sourceOf(long), "CG01.dat"),
		).toBe(true);
		const short = buildEpf(
			{ width: 0x100, height: 2, bitsPerPixel: 24, short: true },
			Buffer.alloc(0),
			Buffer.alloc(4, 0x00),
		);
		expect(
			await interheartEpfImageFormat.detect(sourceOf(short), "CG01.dat"),
		).toBe(true);
	});

	it("needs a header size it knows, a version and a depth", async () => {
		const coded = Buffer.from([0x03, 1, 2]);
		const cases: HeaderOptions[] = [
			{ width: 5, height: 1, bitsPerPixel: 8, headerSize: 12 },
			{ width: 5, height: 1, bitsPerPixel: 8, version: 3 },
			{ width: 5, height: 1, bitsPerPixel: 0 },
			{ width: 5, height: 1, bitsPerPixel: 33 },
			{ width: 0, height: 1, bitsPerPixel: 8 },
		];
		for (const options of cases) {
			const file = buildEpf(options, Buffer.alloc(0), coded);
			expect(
				await interheartEpfImageFormat.detect(sourceOf(file), "CG.dat"),
			).toBe(false);
		}
		expect(
			await interheartEpfImageFormat.detect(
				sourceOf(Buffer.alloc(6, 0x00)),
				"CG.dat",
			),
		).toBe(false);
	});

	it("reads its measurements from either header form", async () => {
		const long = buildEpf(
			{
				width: 40,
				height: 30,
				bitsPerPixel: 8,
				colors: 16,
				offsetX: -3,
				offsetY: 7,
			},
			buildPalette(
				Array.from({ length: 16 }, () => [0, 0, 0] as [number, number, number]),
			),
			Buffer.alloc(20, 0x00),
		);
		const archive = await interheartEpfImageFormat.open(
			sourceOf(long),
			"CG01.bin",
		);
		try {
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 40,
				height: 30,
				bitsPerPixel: 8,
				colors: 16,
				version: 1,
				offsetX: -3,
				offsetY: 7,
			});
		} finally {
			await archive.close();
		}
		const short = buildEpf(
			{
				width: 8,
				height: 4,
				bitsPerPixel: 24,
				version: 2,
				colors: 5,
				short: true,
			},
			buildPalette(
				Array.from({ length: 5 }, () => [0, 0, 0] as [number, number, number]),
			),
			Buffer.alloc(20, 0x00),
		);
		const other = await interheartEpfImageFormat.open(
			sourceOf(short),
			"CG01.bin",
		);
		try {
			const metadata = other.entries[0]?.metadata ?? {};
			expect(metadata).toMatchObject({
				width: 8,
				height: 4,
				bitsPerPixel: 24,
				version: 2,
			});
			// The ten byte form has no offsets at all.
			expect(metadata).not.toHaveProperty("offsetX");
		} finally {
			await other.close();
		}
	});

	it("expands a literal run behind the palette", async () => {
		// One control byte whose first run is five set bits: five literals, which is all the row holds.
		const palette = buildPalette([
			[0x11, 0x22, 0x33],
			[0x44, 0x55, 0x66],
			[0x77, 0x88, 0x99],
		]);
		const file = buildEpf(
			{ width: 5, height: 1, bitsPerPixel: 8, colors: 3 },
			palette,
			Buffer.from([0x1f, 7, 8, 9, 10, 11]),
		);
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(8);
		// The three entries are stored red, green and blue and land blue, green, red with the fourth byte unused.
		expect(output.subarray(54, 66)).toEqual(
			Buffer.from([
				0x33, 0x22, 0x11, 0x00, 0x66, 0x55, 0x44, 0x00, 0x99, 0x88, 0x77, 0x00,
			]),
		);
		expect(output.subarray(1078, 1083)).toEqual(Buffer.from([7, 8, 9, 10, 11]));
	});

	it("copies a match out of the window", async () => {
		// Two literals, then one match of three bytes from offset zero: the window is zeroes behind them.
		const file = buildEpf(
			{ width: 5, height: 1, bitsPerPixel: 8 },
			Buffer.alloc(0),
			Buffer.from([0x03, 0xaa, 0xbb, 0x00, 0x00]),
		);
		const output = await extract(file);
		// The window advances as it is written, so the third byte the match reads is the first one it wrote.
		expect(output.subarray(1078, 1083)).toEqual(
			Buffer.from([0xaa, 0xbb, 0xaa, 0xbb, 0xaa]),
		);
	});

	it("unshuffles a block that stores its columns one after the other", async () => {
		// Two by three pixels of three bytes: eighteen literals in three control bytes.
		const stored = Buffer.from(Array.from({ length: 18 }, (_, index) => index));
		const coded = Buffer.concat([
			Buffer.from([0xff]),
			stored.subarray(0, 8),
			Buffer.from([0xff]),
			stored.subarray(8, 16),
			Buffer.from([0x03]),
			stored.subarray(16, 18),
		]);
		const file = buildEpf(
			{ width: 2, height: 3, bitsPerPixel: 24 },
			Buffer.alloc(0),
			coded,
		);
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(24);
		// Every column is stored in one piece and every pixel comes back reversed, so the second pixel of a row
		// is the one the first column's third row follows.
		const row = 54;
		expect(output.subarray(row, row + 6)).toEqual(
			Buffer.from([2, 1, 0, 11, 10, 9]),
		);
		expect(output.subarray(row + 8, row + 14)).toEqual(
			Buffer.from([5, 4, 3, 14, 13, 12]),
		);
		expect(output.subarray(row + 16, row + 22)).toEqual(
			Buffer.from([8, 7, 6, 17, 16, 15]),
		);
	});

	it("keeps one bit pixels packed and gives them two colours", async () => {
		const palette = buildPalette([
			[0x00, 0x00, 0x00],
			[0xff, 0xff, 0xff],
		]);
		const file = buildEpf(
			{ width: 10, height: 1, bitsPerPixel: 1, colors: 2 },
			palette,
			Buffer.from([0x03, 0xa5, 0x5a]),
		);
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(1);
		expect(output.readUInt32LE(46)).toBe(2);
		expect(output.subarray(54, 62)).toEqual(
			Buffer.from([0x00, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00]),
		);
		// Nothing is shuffled for this depth, so the packed bytes are the ones the stream held.
		expect(output.subarray(62, 66)).toEqual(
			Buffer.from([0xa5, 0x5a, 0x00, 0x00]),
		);
	});

	it("treats a thirty two bit image of the first version as twenty four", async () => {
		const file = buildEpf(
			{ width: 1, height: 1, bitsPerPixel: 32, version: 1 },
			Buffer.alloc(0),
			Buffer.from([0x03, 0x10, 0x20, 0x00, 0x00]),
		);
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(24);
		// One literal of each channel and one the match copies from the window, written back reversed.
		expect(output.subarray(54, 57)).toEqual(Buffer.from([0x10, 0x20, 0x10]));
	});

	it("writes the alpha of the second version in front of the colours", async () => {
		const file = buildEpf(
			{ width: 1, height: 1, bitsPerPixel: 32, version: 2 },
			Buffer.alloc(0),
			Buffer.from([0x0f, 0xaa, 0x11, 0x22, 0x33]),
		);
		const output = await extract(file);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54, 58)).toEqual(
			Buffer.from([0x33, 0x22, 0x11, 0xaa]),
		);
	});

	it("stops at the end of a stream and refuses one that stops in a literal run", async () => {
		// A row of twelve where one control byte's single run of eight literals is coded: the run is used up and the
		// stream is over, so the rest of the pixels keep the zeroes they were allocated with.
		const short = await extract(
			buildEpf(
				{ width: 12, height: 1, bitsPerPixel: 8 },
				Buffer.alloc(0),
				Buffer.from([0xff, 1, 2, 3, 4, 5, 6, 7, 8]),
			),
		);
		expect(short.subarray(1078, 1090)).toEqual(
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 0, 0, 0, 0]),
		);
		const cut = buildEpf(
			{ width: 5, height: 1, bitsPerPixel: 8 },
			Buffer.alloc(0),
			Buffer.from([0x1f, 1, 2]),
		);
		await expect(extract(cut)).rejects.toThrow(/literal run/);
	});

	it("names the entry after the image", async () => {
		const file = buildEpf(
			{ width: 5, height: 1, bitsPerPixel: 8 },
			Buffer.alloc(0),
			Buffer.from([0x1f, 1, 2, 3, 4, 5]),
		);
		const archive = await interheartEpfImageFormat.open(
			sourceOf(file),
			"sub/CG07.epf",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG07.bmp");
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.metadata).toMatchObject({
				image: "bmp",
				compression: "candy-lz",
			});
		} finally {
			await archive.close();
		}
	});
});
