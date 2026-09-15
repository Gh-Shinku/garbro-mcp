import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	iarBytesPerPixel,
	iarOutputDepth,
	readIarLayout,
	readIarPalette,
	sas5IarImageFormat,
} from "../../packages/formats/src/sas5/iar-image.js";

const HEADER_SIZE = 0x28;
const PALETTE_OFFSET = 0x36;
const GREY_PALETTE_SIZE = 0x400;
const DATA_OFFSET = 0x36 + GREY_PALETTE_SIZE;

interface HeaderParts {
	width?: number;
	height?: number;
	offsetX?: number;
	offsetY?: number;
	bitsPerPixel?: number;
	stride?: number;
	paletteSize?: number;
	imageSize?: number;
	/** A word other than the `SAS5` the reference checks. */
	tag?: string;
}

/** The forty bytes the format begins a picture with. */
function iarHeader(parts: HeaderParts, pixels: number): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write("IAR\0", 0, "latin1");
	head.write(parts.tag ?? "SAS5", 4, "latin1");
	head.writeUInt32LE(parts.width ?? 2, 0x08);
	head.writeUInt32LE(parts.height ?? 1, 0x0c);
	head.writeInt32LE(parts.offsetX ?? 0, 0x10);
	head.writeInt32LE(parts.offsetY ?? 0, 0x14);
	head.writeInt32LE(parts.bitsPerPixel ?? 24, 0x18);
	head.writeInt32LE(parts.stride ?? (parts.width ?? 2) * 3, 0x1c);
	head.writeInt32LE(parts.paletteSize ?? 0, 0x20);
	head.writeInt32LE(parts.imageSize ?? pixels, 0x24);
	return head;
}

/** A whole file: the header, the colour map and the pixels. */
function iarFile(
	parts: HeaderParts,
	entries: Buffer[],
	pixels: Buffer,
): Buffer {
	const palette = Buffer.concat(entries);
	const head = iarHeader(
		{
			...parts,
			paletteSize: parts.paletteSize ?? palette.length,
			imageSize: parts.imageSize ?? pixels.length,
		},
		pixels.length,
	);
	return Buffer.concat([head, palette, pixels]);
}

/** A colour map of three byte entries that stand blue, green, red, the way the reference reads them. */
function paletteOf(bytesPerEntry: number, entries = 0x100): Buffer {
	const data: Buffer = Buffer.alloc(bytesPerEntry * entries, 0x00);
	for (let index = 0; index < entries; index += 1) {
		const at = index * bytesPerEntry;
		data[at] = (0x11 + index) & 0xff;
		data[at + 1] = (0x22 + index) & 0xff;
		data[at + 2] = (0x33 + index) & 0xff;
	}
	return data;
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.iar"): Promise<Buffer> {
	const handle = await sas5IarImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of a picture of this width, row by row as the writer stored them. */
function pixelRows(
	bitmap: Buffer,
	width: number,
	height: number,
	bytesPerPixel: number,
	offset = DATA_OFFSET,
): string[] {
	const stride = (width * bytesPerPixel + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					offset + row * stride,
					offset + row * stride + width * bytesPerPixel,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("SAS5 picture format", () => {
	it("finds a picture by its four letters and the word behind them", async () => {
		const data = iarFile({}, [], Buffer.from([1, 2, 3, 4, 5, 6]));
		expect(await sas5IarImageFormat.detect(sourceOf(data), "cg.iar")).toBe(
			true,
		);
		expect(
			await sas5IarImageFormat.detect(
				sourceOf(iarFile({ tag: "SAS6" }, [], Buffer.from([1, 2, 3]))),
				"cg.iar",
			),
		).toBe(false);
		const odd = Buffer.from(data);
		odd.write("IAP\0", 0, "latin1");
		expect(await sas5IarImageFormat.detect(sourceOf(odd), "cg.iar")).toBe(
			false,
		);
		expect(readIarLayout(Buffer.alloc(HEADER_SIZE - 1, 0))).toBeUndefined();
		// A picture of no width or height, of no length of a row, or with a size below nothing is turned away.
		expect(readIarLayout(iarHeader({ width: 0 }, 0))).toBeUndefined();
		expect(readIarLayout(iarHeader({ height: 0 }, 0))).toBeUndefined();
		expect(readIarLayout(iarHeader({ stride: 0 }, 0))).toBeUndefined();
		expect(readIarLayout(iarHeader({ imageSize: -1 }, 0))).toBeUndefined();
	});

	it("reports the measurements, the place the picture stands at and the depth it writes out", async () => {
		const handle = await sas5IarImageFormat.open(
			sourceOf(
				iarFile(
					{ width: 2, height: 2, offsetX: -5, offsetY: 7, bitsPerPixel: 32 },
					[],
					Buffer.alloc(16, 0x11),
				),
			),
			"dir/cg.iar",
		);
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 32,
			offsetX: 5,
			offsetY: -7,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			width: 2,
			height: 2,
		});
	});

	it("writes a picture of three channels out as it stands", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6]);
		const bitmap = await extract(iarFile({}, [], pixels));
		expect(bitmap.readUInt16LE(0x1c)).toBe(24);
		expect(bitmap.readInt32LE(0x16)).toBe(-1);
		expect(bitmap.subarray(DATA_OFFSET - GREY_PALETTE_SIZE)).toBeDefined();
		expect(pixelRows(bitmap, 2, 1, 3, 0x36)).toEqual(["010203040506"]);
	});

	it("writes a picture of four channels out as it stands", async () => {
		const pixels = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const bitmap = await extract(
			iarFile({ bitsPerPixel: 32, stride: 8, imageSize: 8 }, [], pixels),
		);
		expect(bitmap.readUInt16LE(0x1c)).toBe(32);
		expect(pixelRows(bitmap, 2, 1, 4, 0x36)).toEqual(["0102030405060708"]);
	});

	it("writes a picture with no colour map out as a grey one", async () => {
		const pixels = Buffer.from([0x00, 0x40, 0x80, 0xc0]);
		const bitmap = await extract(
			iarFile(
				{ width: 4, bitsPerPixel: 8, stride: 4, imageSize: 4 },
				[],
				pixels,
			),
		);
		expect(bitmap.readUInt16LE(0x1c)).toBe(8);
		expect(bitmap.readUInt32LE(0x2e)).toBe(0x100);
		// The colour map of a grey picture is the ramp the writer gives it.
		expect(bitmap.readUInt32LE(PALETTE_OFFSET)).toBe(0x00000000);
		expect(bitmap.readUInt32LE(PALETTE_OFFSET + 4)).toBe(0x00010101);
		expect(bitmap.readUInt32LE(PALETTE_OFFSET + 8)).toBe(0x00020202);
		expect(bitmap.subarray(DATA_OFFSET, DATA_OFFSET + 4).toString("hex")).toBe(
			"004080c0",
		);
	});

	it("writes the colour map of the picture out the way the reference reads it", async () => {
		const bitmap = await extract(
			iarFile(
				{ bitsPerPixel: 8, stride: 2, paletteSize: 0x300, imageSize: 2 },
				[paletteOf(3)],
				Buffer.from([0x00, 0x01]),
			),
		);
		expect(bitmap.readUInt32LE(0x0a)).toBe(DATA_OFFSET);
		expect(
			bitmap.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 8).toString("hex"),
		).toBe("1122330012233400");
		expect(bitmap.subarray(DATA_OFFSET, DATA_OFFSET + 4).toString("hex")).toBe(
			"00010000",
		);
	});

	it("takes the entries of a colour map out of every fourth byte where the map is that long", async () => {
		const bitmap = await extract(
			iarFile(
				{ bitsPerPixel: 8, stride: 1, paletteSize: 0x400, imageSize: 1 },
				[paletteOf(4)],
				Buffer.from([0x00]),
			),
		);
		expect(
			bitmap.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 8).toString("hex"),
		).toBe("1122330012233400");
	});

	it("makes every entry of a colour map shorter than a full one the same one", async () => {
		// A map of `0x80` bytes gives entries of no length at all, so every entry is read from its start.
		const short: Buffer = Buffer.alloc(0x80, 0x7e);
		short[0] = 0x11;
		short[1] = 0x22;
		short[2] = 0x33;
		const bitmap = await extract(
			iarFile(
				{ bitsPerPixel: 8, stride: 1, paletteSize: 0x80, imageSize: 1 },
				[short],
				Buffer.from([0x00]),
			),
		);
		expect(
			bitmap.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 8).toString("hex"),
		).toBe("1122330011223300");
	});

	it("packs the rows a longer row leaves room behind", async () => {
		// A picture three pixels wide whose rows are four bytes long, which is what a padded row looks like.
		const bitmap = await extract(
			iarFile(
				{ width: 3, height: 2, bitsPerPixel: 8, stride: 4, imageSize: 8 },
				[],
				Buffer.from([1, 2, 3, 0xee, 4, 5, 6, 0xee]),
			),
		);
		expect(pixelRows(bitmap, 3, 2, 1)).toEqual(["010203", "040506"]);
	});

	it("leaves the pixels behind a longer picture behind", async () => {
		const bitmap = await extract(
			iarFile({}, [], Buffer.from([1, 2, 3, 4, 5, 6, 0xff, 0xff])),
		);
		expect(pixelRows(bitmap, 2, 1, 3, 0x36)).toEqual(["010203040506"]);
	});

	it("refuses a picture the pixels are shorter than the rows of", async () => {
		const data = iarFile(
			{ width: 2, height: 2, imageSize: 6 },
			[],
			Buffer.from([1, 2, 3, 4, 5, 6]),
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"SAS5 picture is cut short of its pixels",
		);
	});

	it("refuses a picture the colour map is shorter than it says", async () => {
		const head = iarHeader(
			{ bitsPerPixel: 8, stride: 1, paletteSize: 0x300, imageSize: 1 },
			1,
		);
		const data = Buffer.concat([head, paletteOf(3).subarray(0, 0x200)]);
		await expect(extract(data)).rejects.toThrow(
			"SAS5 picture is cut short of its colour map",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = iarFile(
			{ width: 65535, height: 65535, bitsPerPixel: 32, stride: 65535 * 4 },
			[],
			Buffer.alloc(0),
		);
		expect(await sas5IarImageFormat.detect(sourceOf(data), "cg.iar")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("reads the depth of the kinds of picture the format knows", () => {
		const layout = readIarLayout(iarFile({}, [], Buffer.from([1, 2, 3])));
		if (!layout) throw new Error("no layout");
		expect(iarBytesPerPixel(layout)).toBe(3);
		expect(iarOutputDepth(layout)).toBe(24);
		expect(
			readIarPalette(Buffer.from([1, 2, 3]), 3)
				.subarray(0, 4)
				.toString("hex"),
		).toBe("01020300");
	});
});
