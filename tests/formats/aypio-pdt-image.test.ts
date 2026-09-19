import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	aypioPdtImageFormat,
	decodePdt,
	flattenPdtPlanes,
	readPdt4Layout,
	readPdtPalette,
} from "../../packages/formats/src/aypio/pdt-image.js";

/** A UK2 engine picture: its head of forty three bytes and the four planes behind it. */
function pdtFile(input: {
	left: number;
	top: number;
	right: number;
	bottom: number;
	rle1?: number;
	rle2?: number;
	planes: Buffer[];
}): Buffer {
	const head = Buffer.alloc(0x2b, 0x00);
	head[0] = 0x34;
	for (let entry = 0; entry < 16; entry += 1) {
		// Every colour stands for its own number in all three of its parts.
		head.writeUInt16LE(entry * 0x111, 1 + entry * 2);
	}
	head[0x21] = input.rle1 ?? 0xfe;
	head[0x22] = input.rle2 ?? 0xfd;
	head.writeUInt16LE(input.left, 0x23);
	head.writeUInt16LE(input.top, 0x25);
	head.writeUInt16LE(input.right, 0x27);
	head.writeUInt16LE(input.bottom, 0x29);
	return Buffer.concat([head, ...input.planes]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await aypioPdtImageFormat.open(
		new BufferByteSource(data),
		"picture.pdt",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The pixels of a bitmap of four bits, whose palette stands from `0x36` and whose pixels stand from `0x76`. */
function bmpPixels(bmp: Buffer): string {
	return bmp.subarray(0x76, 0x76 + 8).toString("hex");
}

describe("UK2 engine image format", () => {
	it("reads the head of a picture", () => {
		// The width stands in the places of the bits between the edges: one byte for every eight of them.
		const data = pdtFile({
			left: 2,
			top: 3,
			right: 5,
			bottom: 8,
			planes: [Buffer.alloc(8, 0x00)],
		});
		expect(readPdt4Layout(data)).toEqual({
			width: 32,
			height: 6,
			offsetX: 16,
			offsetY: 3,
			rle1: 0xfe,
			rle2: 0xfd,
		});
		const other = Buffer.from(data);
		other[0] = 0x35;
		expect(readPdt4Layout(other)).toBeUndefined();
		// A picture of more than two thousand and forty eight places of width is turned away.
		const wide = pdtFile({
			left: 0,
			top: 0,
			right: 300,
			bottom: 1,
			planes: [],
		});
		expect(readPdt4Layout(wide)).toBeUndefined();
	});

	it("reads the colours of a picture", () => {
		const data = pdtFile({
			left: 0,
			top: 0,
			right: 0,
			bottom: 1,
			planes: [],
		});
		const palette = readPdtPalette(data);
		expect(Array.from(palette.subarray(0, 6))).toEqual([0, 0, 0, 17, 17, 17]);
	});

	it("stands the places of the four planes together", () => {
		// One byte of every plane stands for eight places of a row: the first plane in the highest place of a
		// colour, the second behind it and so on, two colours of four places in every byte.
		const planes = [
			Buffer.from([0x80]),
			Buffer.from([0x40]),
			Buffer.from([0x20]),
			Buffer.from([0x10]),
		];
		expect(flattenPdtPlanes(planes).toString("hex")).toBe(
			hex([0x12, 0x48, 0, 0]),
		);
	});

	it("walks the planes of a picture of pairs of rows", () => {
		// Eight places of width and two of height: one byte of a plane a row, and one pair of rows a step of
		// the walk. The bytes of the four planes walk the colours of the picture.
		const planes = [
			Buffer.from([0x80, 0x00]),
			Buffer.from([0x40, 0x80]),
			Buffer.from([0x20, 0x40]),
			Buffer.from([0x10, 0x20]),
		];
		const data = pdtFile({
			left: 0,
			top: 0,
			right: 0,
			bottom: 1,
			planes,
		});
		const layout = readPdt4Layout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodePdt(data, layout);
		expect(bmp.readUInt16LE(0x1c)).toBe(4);
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		expect(bmp.readUInt32LE(0x2e)).toBe(16);
		expect(bmpPixels(bmp)).toBe(hex([0x12, 0x48, 0, 0, 0x24, 0x80, 0, 0]));
	});

	it("walks the two walks of a plane", () => {
		// A byte that is the first of the two the head names names how many pairs of rows stand there and the
		// two bytes of the pair; a byte that is the second names how many pairs stand there and the one byte
		// the two rows of a pair stand for.
		const planes = [
			Buffer.from([0xfe, 0x01, 0xaa, 0x55]),
			Buffer.from([0xfd, 0x01, 0x0f]),
			Buffer.from([0xfe, 0x01, 0x00, 0xf0]),
			Buffer.from([0xfd, 0x01, 0xf0]),
		];
		const data = pdtFile({
			left: 0,
			top: 0,
			right: 0,
			bottom: 1,
			planes,
		});
		const layout = readPdt4Layout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodePdt(data, layout);
		// The second plane carries the places nought to three of its byte, so its colours stand in the third
		// and the fourth byte of the row.
		expect(bmpPixels(bmp)).toBe(
			hex([0x98, 0x98, 0x32, 0x32, 0xcd, 0xcd, 0x23, 0x23]),
		);
	});

	it("gathers a picture into a bitmap", async () => {
		const planes = [
			Buffer.from([0x80, 0x00]),
			Buffer.from([0x40, 0x80]),
			Buffer.from([0x20, 0x40]),
			Buffer.from([0x10, 0x20]),
		];
		const data = pdtFile({
			left: 0,
			top: 0,
			right: 0,
			bottom: 1,
			planes,
		});
		const bmp = await extract(data);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt32LE(0x12)).toBe(8);
		expect(bmp.readInt32LE(0x16)).toBe(-2);
		// The colours of the head stand in the bitmap behind a colour of nought.
		expect(bmp.subarray(0x36 + 4, 0x36 + 8).toString("hex")).toBe(
			hex([17, 17, 17, 0]),
		);
		expect(bmp.readUInt32LE(0x36 + 4)).toBe(0x111111);
	});

	it("declines a file that does not hold a picture", async () => {
		const other = pdtFile({
			left: 0,
			top: 0,
			right: 0,
			bottom: 1,
			planes: [Buffer.alloc(8, 0x00)],
		});
		other[0] = 0x35;
		await expect(
			aypioPdtImageFormat.open(new BufferByteSource(other), "picture.pdt"),
		).rejects.toThrow(GarbroError);
		await expect(
			aypioPdtImageFormat.open(new BufferByteSource(other), "picture.pdt"),
		).rejects.toThrow("Not a UK2 engine picture");
	});

	it("stops where the planes run out of the file", () => {
		const data = pdtFile({
			left: 0,
			top: 0,
			right: 1,
			bottom: 3,
			planes: [Buffer.alloc(2, 0x00)],
		});
		const layout = readPdt4Layout(data);
		if (!layout) throw new Error("no layout");
		expect(() => decodePdt(data, layout)).toThrow(
			"UK2 picture is cut short of its planes",
		);
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
