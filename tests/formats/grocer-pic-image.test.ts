import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodePic,
	grocerPicImageFormat,
	readGrocerPicLayout,
	readPicPalette,
} from "../../packages/formats/src/grocer/pic-image.js";

/** A Grocer picture: its head of eighty seven bytes and the walk of its rows behind it. */
function picFile(input: {
	width: number;
	height: number;
	body: Buffer;
	mark?: string;
}): Buffer {
	const head = Buffer.alloc(0x57, 0x00);
	head[0] = 0x01;
	head.write(input.mark ?? "Actor98", 0x10, "latin1");
	for (let entry = 0; entry < 16; entry += 1) {
		head[0x21 + entry * 3] = entry;
		head[0x22 + entry * 3] = entry * 2;
		head[0x23 + entry * 3] = entry * 3;
	}
	head.writeUInt16LE(input.width >> 3, 0x53);
	head.writeUInt16LE(input.height, 0x55);
	return Buffer.concat([head, input.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await grocerPicImageFormat.open(
		new BufferByteSource(data),
		"picture.pic",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The walk of three rows of eight places of width: the steps take their bytes from one another. */
const THREE_ROWS = Buffer.from([
	// The first row: a byte of the first plane stands for itself, and the three planes behind it take the
	// byte of the plane in front.
	0x80,
	0x03, 0x01, 0x04, 0x01, 0x05, 0x01,
	// The second row: a byte of the first plane stands for a run of one, the third plane stands behind a byte
	// that names it, and the two others stand as nought.
	0x01,
	0x01, 0x40, 0x00, 0x06, 0x20, 0x00,
	// The third row: the first plane takes the byte of the plane of the row two rows behind.
	0x02,
	0x01, 0x00, 0x00, 0x00,
]);

describe("Grocer image format", () => {
	it("reads the head of a picture", () => {
		const data = picFile({ width: 8, height: 3, body: THREE_ROWS });
		expect(readGrocerPicLayout(data)).toEqual({
			width: 8,
			height: 3,
			stride: 1,
		});
		const other = Buffer.from(data);
		other[0] = 0x02;
		expect(readGrocerPicLayout(other)).toBeUndefined();
		const noMark = picFile({
			width: 8,
			height: 3,
			body: THREE_ROWS,
			mark: "Actor99",
		});
		expect(readGrocerPicLayout(noMark)).toBeUndefined();
		// A picture of more than six hundred and forty places of width is turned away.
		const wide = picFile({ width: 648, height: 1, body: THREE_ROWS });
		expect(readGrocerPicLayout(wide)).toBeUndefined();
	});

	it("reads the colours of a picture", () => {
		const data = picFile({ width: 8, height: 1, body: Buffer.alloc(4, 0x00) });
		const palette = readPicPalette(data);
		// The green of a colour stands first in the file, then its red and its blue, and a bitmap holds its
		// colours blue first.
		expect(Array.from(palette.subarray(0, 8))).toEqual([
			0, 0, 0, 0, 51, 17, 34, 0,
		]);
	});

	it("gathers the places of the four planes of a row", () => {
		const data = picFile({
			width: 8,
			height: 1,
			body: Buffer.from([0x80, 0x40, 0x20, 0x10]),
		});
		const layout = readGrocerPicLayout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodePic(data, layout);
		// The first plane stands in the lowest place of a colour and the fourth in the highest.
		expect(bmp.readUInt32LE(0x12)).toBe(8);
		expect(bmp.readInt32LE(0x16)).toBe(-1);
		expect(bmp.readUInt32LE(0x2e)).toBe(256);
		expect(bmp.subarray(0x436, 0x43e).toString("hex")).toBe(
			hex([1, 2, 4, 8, 0, 0, 0, 0]),
		);
	});

	it("walks the steps of a picture that take their bytes from other places", () => {
		const data = picFile({ width: 8, height: 3, body: THREE_ROWS });
		const layout = readGrocerPicLayout(data);
		if (!layout) throw new Error("no layout");
		const bmp = decodePic(data, layout);
		expect(bmp.subarray(0x436, 0x436 + 24).toString("hex")).toBe(
			hex([
				15, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 0, 0, 0, 0, 0, 1, 0, 0, 0, 0, 0, 0, 0,
			]),
		);
	});

	it("gathers a picture into a bitmap", async () => {
		const data = picFile({
			width: 8,
			height: 1,
			body: Buffer.from([0x80, 0x40, 0x20, 0x10]),
		});
		const bmp = await extract(data);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt32LE(0x12)).toBe(8);
		// The colours of the head stand in the bitmap with a colour of nought behind them.
		expect(bmp.subarray(0x36 + 4, 0x36 + 8).toString("hex")).toBe(
			hex([51, 17, 34, 0]),
		);
		expect(bmp.subarray(0x436, 0x43e).toString("hex")).toBe(
			hex([1, 2, 4, 8, 0, 0, 0, 0]),
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const other = picFile({
			width: 8,
			height: 1,
			body: Buffer.from([0x80, 0x40, 0x20, 0x10]),
		});
		other[0] = 0x02;
		await expect(
			grocerPicImageFormat.open(new BufferByteSource(other), "picture.pic"),
		).rejects.toThrow(GarbroError);
		await expect(
			grocerPicImageFormat.open(new BufferByteSource(other), "picture.pic"),
		).rejects.toThrow("Not a Grocer picture");
	});

	it("stops where the walk runs out of the file", () => {
		const data = picFile({ width: 8, height: 1, body: Buffer.from([0x80]) });
		const layout = readGrocerPicLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => decodePic(data, layout)).toThrow(
			"Grocer picture is cut short of its walk",
		);
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
