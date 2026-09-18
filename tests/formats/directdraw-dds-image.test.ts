import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	directDrawDdsImageFormat,
	readDdsLayout,
	readDdsPicture,
	readDdsPixels,
} from "../../packages/formats/src/directdraw/dds-image.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** The places of the flags the reference knows. */
const ALPHA_PIXELS = 0x01;
const FOUR_CC = 0x04;
const RGB = 0x40;

/** A texture: a head of a hundred and twenty four bytes and then the pixels. */
function ddsFile(input: {
	width: number;
	height: number;
	bpp?: number;
	flags?: number;
	fourCc?: string;
	masks?: [number, number, number, number];
	body: Buffer;
	size?: number;
	mark?: string;
}): Buffer {
	const size = input.size ?? 0x7c;
	const head = Buffer.alloc(4 + size, 0x00);
	Buffer.from(input.mark ?? "DDS ", "latin1").copy(head, 0);
	head.writeInt32LE(size, 4);
	head.writeUInt32LE(input.height, 0x0c);
	head.writeUInt32LE(input.width, 0x10);
	head.writeUInt32LE(input.flags ?? 0, 0x50);
	if (input.fourCc) head.write(input.fourCc, 0x54, "latin1");
	head.writeInt32LE(input.bpp ?? 32, 0x58);
	const masks = input.masks ?? [0xff0000, 0x00ff00, 0x0000ff, 0xff000000];
	head.writeUInt32LE(masks[0], 0x5c);
	head.writeUInt32LE(masks[1], 0x60);
	head.writeUInt32LE(masks[2], 0x64);
	head.writeUInt32LE(masks[3], 0x68);
	return Buffer.concat([head, input.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await directDrawDdsImageFormat.open(
		new BufferByteSource(data),
		"pic.dds",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Direct Draw Surface", () => {
	it("reads the head as the reference does", () => {
		expect(
			readDdsLayout(
				ddsFile({
					width: 4,
					height: 4,
					flags: FOUR_CC,
					fourCc: "DXT5",
					bpp: 0,
					masks: [0, 0, 0, 0],
					body: Buffer.alloc(16, 0x00),
				}),
			),
		).toEqual({
			width: 4,
			height: 4,
			bitsPerPixel: 0,
			dataOffset: 0x80,
			pixelFlags: FOUR_CC,
			fourCc: "DXT5",
			redMask: 0,
			greenMask: 0,
			blueMask: 0,
			alphaMask: 0,
		});
	});

	it("gates on the mark, the size of the head and the places", () => {
		const good = ddsFile({
			width: 2,
			height: 1,
			flags: RGB,
			body: Buffer.alloc(8, 0x00),
		});
		expect(readDdsLayout(good)).toBeDefined();
		expect(
			readDdsLayout(
				ddsFile({
					width: 2,
					height: 1,
					mark: "XDS ",
					body: Buffer.alloc(8, 0),
				}),
			),
		).toBeUndefined();
		// The head has to give itself a hundred and twenty four bytes or more.
		expect(
			readDdsLayout(
				ddsFile({ width: 2, height: 1, size: 0x7b, body: Buffer.alloc(8, 0) }),
			),
		).toBeUndefined();
		expect(
			readDdsLayout(ddsFile({ width: 0, height: 1, body: Buffer.alloc(8, 0) })),
		).toBeUndefined();
	});

	it("reads a picture of thirty two bits a pixel as it stands", async () => {
		const out = await extract(
			ddsFile({
				width: 2,
				height: 1,
				flags: RGB | ALPHA_PIXELS,
				body: Buffer.from([0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1020304050607080");
	});

	it("spreads the places of a colour of sixteen bits out", async () => {
		const out = await extract(
			ddsFile({
				width: 3,
				height: 1,
				bpp: 16,
				flags: RGB,
				masks: [0xf800, 0x07e0, 0x001f, 0],
				body: Buffer.from([0x00, 0xf8, 0xe0, 0x07, 0x1f, 0x00]),
			}),
		);
		// A colour of five, six and five bits: the whole of every place among the three of them.
		expect(out.subarray(0x36, 0x42).toString("hex")).toBe(
			hex([0, 0, 255, 0, 0, 255, 0, 0, 255, 0, 0, 0]),
		);
	});

	it("spreads the places of a colour of eight bits out", async () => {
		const out = await extract(
			ddsFile({
				width: 2,
				height: 1,
				bpp: 8,
				flags: RGB,
				masks: [0xe0, 0x1c, 0x03, 0],
				body: Buffer.from([0xe0, 0x03]),
			}),
		);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0, 0, 255, 0, 255, 0, 0, 0]),
		);
	});

	it("reads a picture of the first kind of block", async () => {
		const block = Buffer.alloc(8, 0x00);
		block.writeUInt16LE(0xffff, 0);
		block.writeUInt16LE(0x0000, 2);
		block.writeUInt32LE(0xe4e4e4e4, 4);
		const out = await extract(
			ddsFile({
				width: 4,
				height: 4,
				flags: FOUR_CC,
				fourCc: "DXT1",
				bpp: 0,
				masks: [0, 0, 0, 0],
				body: block,
			}),
		);
		expect(out.subarray(0x36, 0x36 + 16).toString("hex")).toBe(
			hex([
				255, 255, 255, 255, 0, 0, 0, 255, 170, 170, 170, 255, 85, 85, 85, 255,
			]),
		);
	});

	it("reads a picture of the third and the fifth kind of block", () => {
		const third = Buffer.alloc(16, 0x00);
		third.fill(0xf0, 0, 8);
		third.writeUInt16LE(0xffff, 8);
		third.writeUInt16LE(0x0000, 10);
		third.writeUInt32LE(0xe4e4e4e4, 12);
		const thirdData = ddsFile({
			width: 4,
			height: 4,
			flags: FOUR_CC,
			fourCc: "DXT3",
			bpp: 0,
			masks: [0, 0, 0, 0],
			body: third,
		});
		const thirdLayout = readDdsLayout(thirdData);
		if (!thirdLayout) throw new Error("no layout");
		expect(
			readDdsPicture(thirdData, thirdLayout).subarray(0, 16).toString("hex"),
		).toBe(
			hex([255, 255, 255, 0, 0, 0, 0, 255, 170, 170, 170, 0, 85, 85, 85, 255]),
		);
		const fifth = Buffer.alloc(16, 0x00);
		fifth[0] = 200;
		fifth[1] = 100;
		fifth.writeUInt16LE(0xf800, 8);
		fifth.writeUInt16LE(0x001f, 10);
		fifth.writeUInt32LE(0xe4e4e4e4, 12);
		const fifthData = ddsFile({
			width: 4,
			height: 4,
			flags: FOUR_CC,
			fourCc: "DXT5",
			bpp: 0,
			masks: [0, 0, 0, 0],
			body: fifth,
		});
		const fifthLayout = readDdsLayout(fifthData);
		if (!fifthLayout) throw new Error("no layout");
		expect(
			readDdsPicture(fifthData, fifthLayout).subarray(0, 16).toString("hex"),
		).toBe(
			hex([0, 0, 255, 200, 255, 0, 0, 200, 85, 0, 170, 200, 170, 0, 85, 200]),
		);
	});

	it("turns away a compressed kind it does not read", async () => {
		const data = ddsFile({
			width: 4,
			height: 4,
			flags: FOUR_CC,
			fourCc: "ATI2",
			bpp: 0,
			masks: [0, 0, 0, 0],
			body: Buffer.alloc(16, 0x00),
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Compressed Direct Draw surface of the kind ATI2 not supported",
		);
	});

	it("turns away a colour it does not read", async () => {
		const data = ddsFile({
			width: 2,
			height: 1,
			flags: 0x20000,
			body: Buffer.alloc(8, 0x00),
		});
		await expect(extract(data)).rejects.toThrow(
			"Direct Draw surface of a colour this project does not read",
		);
	});

	it("turns a picture cut short of its pixels away", () => {
		const data = ddsFile({
			width: 4,
			height: 4,
			flags: RGB,
			body: Buffer.alloc(8, 0x00),
		});
		const layout = readDdsLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => readDdsPixels(data, layout)).toThrow(
			"Direct Draw surface is cut short of its pixels",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = ddsFile({
			width: 2,
			height: 1,
			flags: RGB,
			body: Buffer.alloc(8, 0x00),
		});
		data.write("XDS ", 0, "latin1");
		await expect(
			directDrawDdsImageFormat.open(new BufferByteSource(data), "pic.dds"),
		).rejects.toThrow(GarbroError);
		await expect(
			directDrawDdsImageFormat.open(new BufferByteSource(data), "pic.dds"),
		).rejects.toThrow("Not a Direct Draw surface");
	});
});
