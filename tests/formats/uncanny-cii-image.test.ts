import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readCiiLayout,
	readCiiPalette,
	uncannyCiiImageFormat,
	unpackCii,
	unpackCiiRle,
} from "../../packages/formats/src/uncanny/cii-image.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A colour map of as many entries of four bytes as the head gives. */
function paletteBytes(colors: number): Buffer {
	const palette = Buffer.alloc(colors * 4, 0x00);
	for (let entry = 0; entry < colors; entry += 1) {
		palette[entry * 4] = entry;
		palette[entry * 4 + 1] = 0x10;
		palette[entry * 4 + 2] = 0x20;
	}
	return palette;
}

/** A picture: the head of eight bytes, the colour map and then the pixels. */
function ciiFile(input: {
	width: number;
	height: number;
	type: number;
	compressed?: boolean;
	colors?: number;
	body: Buffer;
	palette?: boolean;
}): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.writeUInt16LE(input.type, 0);
	head.writeUInt8(input.compressed ? 0x80 : 0x00, 1);
	head.writeInt16LE(input.width, 2);
	head.writeInt16LE(input.height, 4);
	const colors = input.colors ?? 0;
	head.writeUInt16LE(colors, 6);
	const palette =
		input.palette === false ? Buffer.alloc(0) : paletteBytes(colors);
	return Buffer.concat([head, palette, input.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await uncannyCiiImageFormat.open(
		new BufferByteSource(data),
		"pic.cii",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Uncanny image", () => {
	it("reads the head as the reference does", () => {
		expect(
			readCiiLayout(
				ciiFile({
					width: 2,
					height: 2,
					type: 5,
					colors: 0,
					body: Buffer.alloc(6, 0x00),
				}),
			),
		).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			isCompressed: false,
			stride: 6,
			size: 12,
		});
		// The kinds three and two, with the highest place of the word left out, mean eight and four bits.
		expect(
			readCiiLayout(
				ciiFile({
					width: 2,
					height: 1,
					type: 3,
					colors: 0x100,
					body: Buffer.alloc(2, 0x00),
				}),
			)?.bitsPerPixel,
		).toBe(8);
		expect(
			readCiiLayout(
				ciiFile({
					width: 4,
					height: 1,
					type: 2,
					colors: 0x10,
					body: Buffer.alloc(2, 0x00),
				}),
			)?.bitsPerPixel,
		).toBe(4);
	});

	it("gates on the kind, the sizes and the colours", () => {
		const good = ciiFile({
			width: 2,
			height: 1,
			type: 3,
			colors: 0x100,
			body: Buffer.alloc(2, 0x00),
		});
		expect(readCiiLayout(good)).toBeDefined();
		expect(
			readCiiLayout(
				ciiFile({
					width: 2,
					height: 1,
					type: 7,
					colors: 0,
					body: Buffer.alloc(2, 0x00),
				}),
			),
		).toBeUndefined();
		expect(
			readCiiLayout(
				ciiFile({
					width: 0,
					height: 1,
					type: 3,
					colors: 0x100,
					body: Buffer.alloc(2, 0x00),
				}),
			),
		).toBeUndefined();
		// A picture of eight bits cannot hold more colours than its pixels can name.
		expect(
			readCiiLayout(
				ciiFile({
					width: 2,
					height: 1,
					type: 3,
					colors: 0x100,
					body: Buffer.alloc(2, 0x00),
				}),
			),
		).toBeDefined();
		expect(
			readCiiLayout(
				ciiFile({
					width: 2,
					height: 1,
					type: 2,
					colors: 0x11,
					body: Buffer.alloc(2, 0x00),
				}),
			),
		).toBeUndefined();
		// The highest place of the byte at one says the picture is walked along.
		expect(
			readCiiLayout(
				ciiFile({
					width: 2,
					height: 1,
					type: 3,
					compressed: true,
					colors: 0x100,
					body: Buffer.alloc(2, 0x00),
				}),
			)?.isCompressed,
		).toBe(true);
	});

	it("walks a picture along in runs of a byte and of bytes", () => {
		const output = Buffer.alloc(6, 0x00);
		// A count whose highest place stands is a byte over and over, and any other count is bytes that
		// stand as they are.
		unpackCiiRle(Buffer.from([0x82, 0x11, 0x02, 0x22, 0x33, 0x44]), 0, output);
		expect(output.toString("hex")).toBe(
			hex([0x11, 0x11, 0x11, 0x22, 0x33, 0x44]),
		);
	});

	it("reads an eight bit picture as it stands", async () => {
		const out = await extract(
			ciiFile({
				width: 2,
				height: 2,
				type: 3,
				colors: 0x100,
				body: Buffer.from([0x01, 0x02, 0x03, 0x04]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("00102000");
		// Two pixels a row, every row of the bitmap padded to four bytes.
		expect(out.subarray(0x436, 0x43e).toString("hex")).toBe("0102000003040000");
	});

	it("reads an eight bit picture that is walked along", async () => {
		const out = await extract(
			ciiFile({
				width: 6,
				height: 1,
				type: 3,
				compressed: true,
				colors: 0x100,
				body: Buffer.from([0x83, 0x05, 0x01, 0x06, 0x07]),
			}),
		);
		// Four bytes over and over and then two that stand as they are.
		expect(out.subarray(0x436, 0x43e).toString("hex")).toBe("0505050506070000");
	});

	it("reads a picture of four bits a pixel", async () => {
		const out = await extract(
			ciiFile({
				width: 4,
				height: 1,
				type: 2,
				colors: 0x10,
				// A picture whose height is odd stands with a row of nothing behind it.
				body: Buffer.from([0x12, 0x34, 0x00, 0x00]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(4);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("00102000");
		// Two pixels to a byte, the higher one first.
		expect(out.subarray(0x76, 0x7a).toString("hex")).toBe("12340000");
	});

	it("reads a picture of twenty four bits in blocks of four pixels", async () => {
		// Two signed bytes that step the colours of a block and then four bytes that stand on top of them.
		const body = Buffer.from([0x00, 0x40, 0x80, 0x80, 0x80, 0x80]);
		const data = ciiFile({
			width: 2,
			height: 2,
			type: 5,
			colors: 0,
			body,
			palette: false,
		});
		const layout = readCiiLayout(data);
		if (!layout) throw new Error("no layout");
		// The first of the two signed bytes steps nothing, the second steps the blue up, the green down and
		// the red up — by 113, 44 and 41, which is what the reference's own arithmetic gives.
		const block = unpackCii(data, layout);
		expect(block.toString("hex")).toBe(
			hex([
				0x80 + 113,
				0x80 - 44,
				0x80 + 41,
				0x80 + 113,
				0x80 - 44,
				0x80 + 41,
				0x80 + 113,
				0x80 - 44,
				0x80 + 41,
				0x80 + 113,
				0x80 - 44,
				0x80 + 41,
			]),
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// Two pixels a row, every row of the bitmap padded to four bytes.
		const row = hex([
			0x80 + 113,
			0x80 - 44,
			0x80 + 41,
			0x80 + 113,
			0x80 - 44,
			0x80 + 41,
			0,
			0,
		]);
		expect(out.subarray(0x36, 0x46).toString("hex")).toBe(row + row);
	});

	it("holds the colours of a block between nought and the whole", () => {
		// A byte that stands at the whole with a colour that steps it over the whole of it, and one that
		// stands at nought with a colour that steps it below nought.
		const up = ciiFile({
			width: 2,
			height: 2,
			type: 5,
			colors: 0,
			body: Buffer.from([0x00, 0x40, 0xff, 0xff, 0xff, 0xff]),
			palette: false,
		});
		const upLayout = readCiiLayout(up);
		if (!upLayout) throw new Error("no layout");
		const pixels = unpackCii(up, upLayout);
		// The blue steps the byte past the whole and is held there, the green steps it below the whole of it
		// and is held there, and the red stays inside.
		expect(pixels[0]).toBe(0xff);
		expect(pixels[1]).toBe(0xff - 44);
		expect(pixels[2]).toBe(0xff);
		// Nought with a colour that steps it below nought stands at nought.
		const down = ciiFile({
			width: 2,
			height: 2,
			type: 5,
			colors: 0,
			body: Buffer.from([0x00, 0xc0, 0x00, 0x00, 0x00, 0x00]),
			palette: false,
		});
		const downLayout = readCiiLayout(down);
		if (!downLayout) throw new Error("no layout");
		const held = unpackCii(down, downLayout);
		// The first signed byte stands at nought and the second at minus sixty four: the blue falls and the
		// red climbs, and both of them hold a byte of nought at nought.
		expect(held[0]).toBe(0);
		expect(held[2]).toBe(0);
	});

	it("reads the colour map as the head gives it", () => {
		const data = ciiFile({
			width: 2,
			height: 1,
			type: 3,
			colors: 4,
			body: Buffer.from([0x00, 0x00]),
		});
		const layout = readCiiLayout(data);
		if (!layout) throw new Error("no layout");
		const palette = readCiiPalette(data, layout);
		expect(palette.subarray(0, 8).toString("hex")).toBe(
			hex([0, 0x10, 0x20, 0, 1, 0x10, 0x20, 0]),
		);
		// The entries beyond the ones the head gives stand as nought.
		expect(palette.subarray(16, 20).toString("hex")).toBe("00000000");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = ciiFile({
			width: 2,
			height: 1,
			type: 7,
			colors: 0,
			body: Buffer.alloc(2, 0x00),
		});
		await expect(
			uncannyCiiImageFormat.open(new BufferByteSource(data), "pic.cii"),
		).rejects.toThrow(GarbroError);
		await expect(
			uncannyCiiImageFormat.open(new BufferByteSource(data), "pic.cii"),
		).rejects.toThrow("Not an Uncanny picture");
	});
});
