import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeMmd,
	ivoryMmdImageFormat,
	readMmdLayout,
	readMmdPalette,
} from "../../packages/formats/src/ivory/mmd-image.js";

const HEADER_SIZE = 0x18;
const PALETTE_OFFSET = 0x36;
const GREY_PALETTE_SIZE = 0x400;
const DATA_OFFSET = PALETTE_OFFSET + GREY_PALETTE_SIZE;

interface FileParts {
	/** The bits that say which bytes of the line change. */
	bits: Buffer;
	/** The bytes the line is changed by, taken in the order the bits ask for them. */
	changes: Buffer;
	/** The pixels that stand in the stream themselves. */
	literals: Buffer;
	/** Whatever stands between the pixels and the colour map. */
	filler?: Buffer;
	colors?: number;
	palette?: Buffer;
}

/** A whole file: the header, the three regions it names and the colour map behind them. */
function mmdFile(width: number, height: number, parts: FileParts): Buffer {
	const size1 = parts.bits.length;
	const size2 = size1 + parts.changes.length;
	const size3 = parts.literals.length + (parts.filler?.length ?? 0);
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	Buffer.from([0x4d, 0x4d, 0x44, 0x1a]).copy(head, 0);
	head.writeUInt16LE(width, 4);
	head.writeUInt16LE(height, 6);
	head.writeInt32LE(size1, 8);
	head.writeInt32LE(size2, 0x0c);
	head.writeInt32LE(size3, 0x10);
	head.writeInt32LE(parts.colors ?? 0, 0x14);
	return Buffer.concat([
		head,
		parts.bits,
		parts.changes,
		parts.literals,
		parts.filler ?? Buffer.alloc(0),
		parts.palette ?? Buffer.alloc(0),
	]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "cg.mmd"): Promise<Buffer> {
	const handle = await ivoryMmdImageFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of one byte to the pixel, row by row. */
function pixelRows(bitmap: Buffer, width: number, height: number): string[] {
	const stride = (width + 3) & ~3;
	const rows: string[] = [];
	for (let row = 0; row < height; row += 1) {
		rows.push(
			bitmap
				.subarray(
					DATA_OFFSET + row * stride,
					DATA_OFFSET + row * stride + width,
				)
				.toString("hex"),
		);
	}
	return rows;
}

describe("Ivory picture format of the line kind", () => {
	it("finds a picture by its four bytes", async () => {
		const data = mmdFile(4, 1, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([1, 2, 3, 4]),
		});
		expect(await ivoryMmdImageFormat.detect(sourceOf(data), "cg.mmd")).toBe(
			true,
		);
		expect(readMmdLayout(data)).toMatchObject({
			width: 4,
			height: 1,
			size1: 1,
			size2: 2,
		});
		// The two lengths of the line have to hold something and stand in the right order.
		const short1 = mmdFile(4, 1, {
			bits: Buffer.alloc(0),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([1, 2, 3, 4]),
		});
		expect(readMmdLayout(short1)).toBeUndefined();
		const short2 = mmdFile(4, 1, {
			bits: Buffer.from([0x00]),
			changes: Buffer.alloc(0),
			literals: Buffer.from([1, 2, 3, 4]),
		});
		expect(readMmdLayout(short2)).toBeUndefined();
		const negative = mmdFile(4, 1, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([1, 2, 3, 4]),
			colors: -1,
		});
		expect(readMmdLayout(negative)).toBeUndefined();
		expect(
			readMmdLayout(
				mmdFile(0, 1, {
					bits: Buffer.from([0]),
					changes: Buffer.from([0]),
					literals: Buffer.alloc(0),
				}),
			),
		).toBeUndefined();
		expect(
			readMmdLayout(
				mmdFile(4, 0, {
					bits: Buffer.from([0]),
					changes: Buffer.from([0]),
					literals: Buffer.alloc(0),
				}),
			),
		).toBeUndefined();
		const odd = Buffer.from(data);
		odd.write("MMD\x1B", 0, "latin1");
		expect(readMmdLayout(odd)).toBeUndefined();
		expect(readMmdLayout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
	});

	it("reports the measurements of the picture", async () => {
		const data = mmdFile(4, 2, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		const handle = await ivoryMmdImageFormat.open(sourceOf(data), "dir/cg.mmd");
		expect(handle.entries[0]?.path).toBe("cg.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 4,
			height: 2,
			bitsPerPixel: 8,
		});
		expect(handle.metadata).toMatchObject({ image: "bmp", bitsPerPixel: 8 });
	});

	it("reads the pixels of a picture whose line asks for nothing", async () => {
		// Every bit stands at nothing, so every nibble of every line byte reads its pair out of the stream.
		const data = mmdFile(4, 2, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		const bitmap = await extract(data);
		expect(bitmap.readUInt16LE(0x1c)).toBe(8);
		expect(bitmap.readUInt32LE(0x2e)).toBe(0x100);
		expect(pixelRows(bitmap, 4, 2)).toEqual(["01020304", "05060708"]);
	});

	it("lays the changes the bits ask for over the line", async () => {
		// A picture eight pixels wide and two rows deep, so the line is two bytes long: the first line byte of
		// the first row stands at `0x01`, which asks for a pair of its own out of the stream and then repeats
		// the pair behind it, and the second asks for both of its pairs out of the stream. The second row finds
		// the first of them changed to `0x22`, which copies both pairs from the row above, and the second to
		// `0x11`, which copies the pair behind each of its own.
		const literals = Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]);
		const data = mmdFile(8, 2, {
			bits: Buffer.from([0xb0]),
			changes: Buffer.from([0x01, 0x23, 0x11]),
			literals,
		});
		const bitmap = await extract(data);
		expect(pixelRows(bitmap, 8, 2)).toEqual([
			"1122112233445566",
			"3344556655665566",
		]);
	});

	it("writes the colour map of the picture out with the red byte first", async () => {
		const data = mmdFile(4, 1, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([0, 1, 2, 3]),
			colors: 2,
			palette: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		});
		const bitmap = await extract(data);
		// The first, second and third byte of an entry are its red, its green and its blue.
		expect(
			bitmap.subarray(PALETTE_OFFSET, PALETTE_OFFSET + 8).toString("hex"),
		).toBe("3322110066554400");
		expect(bitmap.readUInt32LE(PALETTE_OFFSET + 4)).toBe(0x00445566);
		// The colour map holds two entries, so nothing stands behind them.
		expect(bitmap.readUInt32LE(PALETTE_OFFSET + 8)).toBe(0x00000000);
		expect(pixelRows(bitmap, 4, 1)).toEqual(["00010203"]);
	});

	it("refuses a pair of pixels that copies from before the start of the picture", async () => {
		// The first line byte stands at `0x40`, which asks for the pair a row above the first one.
		const data = mmdFile(4, 1, {
			bits: Buffer.from([0x80]),
			changes: Buffer.from([0x40]),
			literals: Buffer.from([1, 2, 3, 4]),
		});
		expect(await ivoryMmdImageFormat.detect(sourceOf(data), "cg.mmd")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Ivory picture copies from before its start",
		);
	});

	it("refuses a line the bits or the changes behind them are short of", () => {
		const layout = (data: Buffer) => {
			const found = readMmdLayout(data);
			if (!found) throw new Error("no layout");
			return found;
		};
		// A picture of five rows of eight pixels asks for more than eight bits of its line.
		const bitsShort = mmdFile(8, 5, {
			bits: Buffer.from([0xff]),
			changes: Buffer.alloc(8, 0x00),
			literals: Buffer.alloc(64, 0x00),
		});
		expect(() => decodeMmd(bitsShort, layout(bitsShort))).toThrow(
			"Ivory picture is cut short of its bits",
		);
		// Two bits ask for two changes where the file holds one.
		const changesShort = mmdFile(8, 1, {
			bits: Buffer.from([0xc0]),
			changes: Buffer.from([0x00]),
			literals: Buffer.alloc(8, 0x00),
		});
		expect(() => decodeMmd(changesShort, layout(changesShort))).toThrow(
			"Ivory picture is cut short of its changes",
		);
	});

	it("refuses a colour map the file is short of", () => {
		const data = mmdFile(4, 1, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([0, 0]),
			colors: 3,
			palette: Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		});
		const layout = readMmdLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => readMmdPalette(data, layout)).toThrow(
			"Ivory picture is cut short of its colour map",
		);
	});

	it("refuses a picture it cannot hold", async () => {
		const data = mmdFile(0xffff, 0xffff, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([0x00]),
		});
		expect(await ivoryMmdImageFormat.detect(sourceOf(data), "cg.mmd")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("reads the line of a picture of one byte on its own", () => {
		const data = mmdFile(4, 1, {
			bits: Buffer.from([0x00]),
			changes: Buffer.from([0x00]),
			literals: Buffer.from([0x21, 0x22, 0x23, 0x24]),
		});
		const layout = readMmdLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeMmd(data, layout).toString("hex")).toBe("21222324");
	});
});
