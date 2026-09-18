import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	gameSystemChrImageFormat,
	readChrLayout,
} from "../../packages/formats/src/gamesystem/chr-image.js";

/** A picture: the head, the ran rows and, where there is one, the frame drawn over them. */
function chrFile(input: {
	width: number;
	height: number;
	rows: Buffer;
	overlay?: Buffer;
	offsetX?: number;
	offsetY?: number;
}): Buffer {
	const rgbSize = 0x20 + input.rows.length;
	const head = Buffer.alloc(0x20, 0x00);
	head.writeUInt32LE(rgbSize + (input.overlay ? input.overlay.length : 0), 0);
	head.writeInt32LE(rgbSize, 4);
	head.writeUInt32LE(input.width, 8);
	head.writeUInt32LE(input.height, 0x0c);
	head.writeInt32LE(input.offsetX ?? 0, 0x10);
	head.writeInt32LE(input.offsetY ?? 0, 0x14);
	return Buffer.concat([head, input.rows, input.overlay ?? Buffer.alloc(0)]);
}

/** The frame drawn over the ran rows: the word not read, the count of frames, and the first frame. */
function overlay(input: {
	x: number;
	y: number;
	width: number;
	height: number;
	pixels: Buffer;
	frames?: number;
}): Buffer {
	const head = Buffer.alloc(0x14, 0x00);
	// The overlay's own length, which has to be more than nothing for it to be read at all, then a word
	// that is not read, then the count of frames.
	head.writeInt32LE(0x14 + input.pixels.length, 0);
	head.writeInt32LE(0, 4);
	head.writeInt32LE(input.frames ?? 1, 8);
	head.writeInt16LE(input.x, 0x0c);
	head.writeInt16LE(input.y, 0x0e);
	head.writeInt16LE(input.width, 0x10);
	head.writeInt16LE(input.height, 0x12);
	return Buffer.concat([head, input.pixels]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await gameSystemChrImageFormat.open(
		new BufferByteSource(data),
		"pic.chr",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("'Game System' character image", () => {
	it("reads the head as the reference does", () => {
		const data = chrFile({
			width: 2,
			height: 1,
			rows: Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
		});
		expect(readChrLayout(data)).toMatchObject({
			width: 2,
			height: 1,
			stride: 8,
			offsetX: 0,
			offsetY: 0,
		});
	});

	it("gates on the word of the file's own length and on the measurements", () => {
		const good = chrFile({
			width: 2,
			height: 1,
			rows: Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
		});
		expect(readChrLayout(good)).toBeDefined();
		// The word at nought has to be the length of the file itself.
		const length = Buffer.from(good);
		length.writeUInt32LE(0x100, 0);
		expect(readChrLayout(length)).toBeUndefined();
		const size = Buffer.from(good);
		size.writeInt32LE(0x20, 4);
		expect(readChrLayout(size)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt32LE(0, 8);
		expect(readChrLayout(width)).toBeUndefined();
		const far = Buffer.from(good);
		far.writeInt32LE(0x8000, 0x10);
		expect(readChrLayout(far)).toBeUndefined();
	});

	it("unfolds pixels that stand, pixels repeated and pixels skipped", async () => {
		// One pixel that stands, two that are skipped, and one that stands again; the fourth byte of a
		// standing pixel is its own value doubled, and of a repeated one the whole byte.
		const rows = Buffer.from([
			0x00, 0x11, 0x22, 0x33, 0xa0, 0x00, 0x44, 0x55, 0x66, 0xff,
		]);
		const data = chrFile({ width: 4, height: 1, rows });
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(1);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"11223301000000000000000044556601",
		);
	});

	it("repeats one pixel as many times as the control says", () => {
		const rows = Buffer.from([0x80, 0x77, 0x88, 0x99, 0xff]);
		const data = chrFile({ width: 2, height: 1, rows });
		return extract(data).then((out) => {
			expect(out.subarray(0x36).toString("hex")).toBe("778899ff778899ff");
		});
	});

	it("draws the frame over the rows it names", async () => {
		const rows = Buffer.concat([
			Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
			Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
			Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
			Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
		]);
		const frame = overlay({
			x: 1,
			y: 0,
			width: 2,
			height: 2,
			pixels: Buffer.from([
				0xa1, 0xa2, 0xa3, 0x80, 0xb1, 0xb2, 0xb3, 0x40, 0xc1, 0xc2, 0xc3, 0x80,
				0xd1, 0xd2, 0xd3, 0x40,
			]),
		});
		const data = chrFile({ width: 4, height: 4, rows, overlay: frame });
		const out = await extract(data);
		// The frame is counted from the bottom edge of the picture, and its fourth byte is stretched from
		// the `0x80` it holds.
		expect(out.subarray(0x36 + 32).toString("hex")).toBe(
			"11223301a1a2a3ffb1b2b37f0000000011223301c1c2c3ffd1d2d37f00000000",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = chrFile({
			width: 2,
			height: 1,
			rows: Buffer.from([0x00, 0x11, 0x22, 0x33, 0xff]),
		});
		data.writeUInt32LE(0x100, 0);
		await expect(
			gameSystemChrImageFormat.open(new BufferByteSource(data), "pic.chr"),
		).rejects.toThrow(GarbroError);
		await expect(
			gameSystemChrImageFormat.open(new BufferByteSource(data), "pic.chr"),
		).rejects.toThrow("Not a 'Game System' picture");
	});
});
