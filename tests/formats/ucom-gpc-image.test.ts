import { BufferByteSource } from "@garbro-mcp/core";
import { ucomGpcImageFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const DATA_OFFSET = 0x2a;

interface Token {
	/** Raw pixels, which the builder writes as one control byte and their bytes. */
	literal?: number[];
	/** One pixel that a token repeats. */
	match?: number[];
	count?: number;
}

type Row = number[] | Token[];

interface GpcOptions {
	width?: number;
	height?: number;
	bitsPerPixel?: number;
	colors?: number;
	palette?: Buffer;
	rows?: Row[];
	/** The alignment bytes the reference reads behind every row, which are not pixels. */
	gapBytes?: number[];
	marker?: Buffer;
	headerSize?: number;
	/** Cuts the file short by this many bytes. */
	truncate?: number;
}

function pixelBytes(count: number, seed: number): number[] {
	return Array.from(
		{ length: count },
		(_, index) => (seed + index * 0x11) & 0xff,
	);
}

function buildGpc(options: GpcOptions = {}): Buffer {
	const width = options.width ?? 2;
	const height = options.height ?? 1;
	const bitsPerPixel = options.bitsPerPixel ?? 24;
	const pixelSize = bitsPerPixel / 8;
	const stride = (width * pixelSize + 3) & ~3;
	const gap = stride - width * pixelSize;
	const parts: Buffer[] = [];
	const header: Buffer = Buffer.alloc(DATA_OFFSET, 0x00);
	(options.marker ?? Buffer.from("GP(\0", "latin1")).copy(header, 0);
	header.writeUInt32LE(width, 6);
	header.writeUInt32LE(height, 0x0a);
	header.writeUInt16LE(bitsPerPixel, 0x10);
	if (options.colors !== undefined) header.writeInt32LE(options.colors, 0x22);
	parts.push(header.subarray(0, options.headerSize ?? DATA_OFFSET));
	if (bitsPerPixel === 8) {
		parts.push(options.palette ?? Buffer.alloc(0));
	}
	const rows =
		options.rows ??
		Array.from({ length: height }, (_, row) => pixelBytes(width, row + 1));
	const gapBytes = Buffer.from(
		Array.from(
			{ length: gap },
			(_, index) => options.gapBytes?.[index] ?? 0x00,
		),
	);
	for (const row of rows) {
		if (typeof row[0] === "object") {
			for (const token of row as Token[]) {
				const count = token.match
					? (token.count ?? 1)
					: (token.literal?.length ?? 0) / pixelSize;
				if (token.match) {
					// Bit zero set: one pixel follows and the run repeats it.
					parts.push(Buffer.from([((count - 1) << 1) | 1, ...token.match]));
				} else {
					parts.push(
						Buffer.from([((count - 1) << 1) & 0xff, ...(token.literal ?? [])]),
					);
				}
			}
		} else {
			const bytes = row as number[];
			// A control byte names pixels, not bytes.
			const count = bytes.length / pixelSize;
			if (count > 0) {
				parts.push(Buffer.from([((count - 1) << 1) & 0xff, ...bytes]));
			}
		}
		parts.push(gapBytes);
	}
	const file = Buffer.concat(parts);
	return options.truncate
		? file.subarray(0, file.length - options.truncate)
		: file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "CG_01.gpc"): Promise<Buffer> {
	const archive = await ucomGpcImageFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("For/Ucom image", () => {
	it("needs a marker, a whole header and one of its three depths", async () => {
		expect(await ucomGpcImageFormat.detect(sourceOf(buildGpc()), "A.gpc")).toBe(
			true,
		);
		// The reference refuses any other depth while reading the header, so detection refuses it too.
		expect(
			await ucomGpcImageFormat.detect(
				sourceOf(buildGpc({ bitsPerPixel: 16 })),
				"A.gpc",
			),
		).toBe(false);
		expect(
			await ucomGpcImageFormat.detect(
				sourceOf(buildGpc({ marker: Buffer.from("GP)\0", "latin1") })),
				"A.gpc",
			),
		).toBe(false);
		// The declared header length is never read, so a file shorter than the fixed header the reader does
		// read has to end inside that header: any pixel data would fill the rest of it out.
		expect(
			await ucomGpcImageFormat.detect(
				sourceOf(buildGpc({ headerSize: 0x25, rows: [] })),
				"A.gpc",
			),
		).toBe(false);
	});

	it("writes a top down bitmap and drops the alignment bytes", async () => {
		const first = [0x11, 0x22, 0x33];
		const second = [0x44, 0x55, 0x66];
		const output = await extract(
			buildGpc({
				width: 2,
				height: 1,
				rows: [[...first, ...second]],
				gapBytes: [0xaa, 0xbb],
			}),
		);
		// This reader does not flip its image, so the bitmap's height is negative.
		expect(output.readInt32LE(22)).toBe(-1);
		expect(output.readUInt16LE(28)).toBe(24);
		// Six bytes of colour in a row a bitmap pads to eight: the fixture's own alignment bytes are gone.
		expect(output.subarray(54)).toEqual(
			Buffer.from([...first, ...second, 0x00, 0x00]),
		);
	});

	it("skips every row's alignment bytes and stores the rows bottom up", async () => {
		const top = [0x0a, 0x0b, 0x0c];
		const bottom = [0x01, 0x02, 0x03];
		// The first row in the file is the image's bottom row, which is how the reference fills its buffer.
		const output = await extract(
			buildGpc({
				width: 1,
				height: 2,
				rows: [[...bottom], [...top]],
				gapBytes: [0xee],
			}),
		);
		expect(output.readInt32LE(22)).toBe(-2);
		// Each bitmap row is padded to four bytes, so the rows sit four bytes apart here.
		expect(output.subarray(54, 57)).toEqual(Buffer.from(top));
		expect(output.subarray(58, 61)).toEqual(Buffer.from(bottom));
	});

	it("repeats the pixel a match token follows", async () => {
		const output = await extract(
			buildGpc({
				width: 3,
				height: 1,
				rows: [
					[
						{ literal: [0x11, 0x22, 0x33] },
						{ match: [0x44, 0x55, 0x66], count: 3 },
					],
				],
			}),
		);
		// One pixel is read and the rest of the run repeats it byte for byte.
		expect(output.subarray(54, 63)).toEqual(
			Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x44, 0x55, 0x66]),
		);
	});

	it("assumes a full palette when an eight bit header names no colours", async () => {
		const palette: Buffer = Buffer.alloc(0x100 * 4, 0x00);
		for (let index = 0; index < 0x100; index += 1) {
			palette[index * 4] = index;
			palette[index * 4 + 1] = 0xff - index;
			palette[index * 4 + 2] = 0x40;
		}
		const pixels = [0x03, 0x02, 0x01, 0x00];
		const output = await extract(
			buildGpc({
				width: 4,
				height: 1,
				bitsPerPixel: 8,
				colors: 0,
				palette,
				rows: [pixels],
			}),
		);
		expect(output.readUInt16LE(28)).toBe(8);
		expect(output.readInt32LE(46)).toBe(0x100);
		expect(output.subarray(54, 54 + 0x100 * 4)).toEqual(palette);
		expect(output.subarray(54 + 0x400, 54 + 0x404)).toEqual(
			Buffer.from(pixels),
		);
	});

	it("honours a colour count that is not zero", async () => {
		const palette: Buffer = Buffer.from([
			0x01, 0x02, 0x03, 0x00, 0x04, 0x05, 0x06, 0x00, 0x07, 0x08, 0x09, 0x00,
		]);
		const pixels = [0x02, 0x01, 0x00, 0x02];
		const output = await extract(
			buildGpc({
				width: 4,
				height: 1,
				bitsPerPixel: 8,
				colors: 3,
				palette,
				rows: [pixels],
			}),
		);
		// Three entries, then the pixels: the count is not rounded up to a full palette.
		expect(output.readInt32LE(46)).toBe(0x100);
		expect(output.subarray(54, 54 + 12)).toEqual(palette);
		expect(output.subarray(54 + 0x400, 54 + 0x404)).toEqual(
			Buffer.from(pixels),
		);
	});

	it("reads a thirty two bit image", async () => {
		const pixels = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88];
		const output = await extract(
			buildGpc({ width: 2, height: 1, bitsPerPixel: 32, rows: [pixels] }),
		);
		expect(output.readUInt16LE(28)).toBe(32);
		expect(output.subarray(54)).toEqual(Buffer.from(pixels));
	});

	it("refuses empty dimensions and a truncated stream", async () => {
		expect(
			await ucomGpcImageFormat.detect(
				sourceOf(buildGpc({ width: 0 })),
				"A.gpc",
			),
		).toBe(true);
		await expect(extract(buildGpc({ width: 0 }))).rejects.toThrow();
		await expect(extract(buildGpc({ truncate: 3 }))).rejects.toThrow();
	});

	it("names the entry after the bitmap and describes it", async () => {
		const archive = await ucomGpcImageFormat.open(
			sourceOf(buildGpc({ width: 5, height: 4 })),
			"sub/CG_07.gpc",
		);
		try {
			expect(archive.entries[0]?.path).toBe("CG_07.bmp");
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({
				type: "image",
				width: 5,
				height: 4,
				bitsPerPixel: 24,
			});
		} finally {
			await archive.close();
		}
	});
});
