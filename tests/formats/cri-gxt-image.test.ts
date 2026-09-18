import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	bitScanReverse,
	criGxtImageFormat,
	readGxtLayout,
	swizzledCoords,
	unpackGxt,
} from "../../packages/formats/src/cri/gxt-image.js";

/** A block of the fifth kind that stands at one colour from corner to corner. */
function solidBlock(colour: number): Buffer {
	const block = Buffer.alloc(16, 0x00);
	block[0] = 0xff; // every place of alpha stands at the whole
	block[1] = 0xff;
	block.writeUInt16LE(colour, 8);
	block.writeUInt16LE(0x0000, 10);
	block.writeUInt32LE(0x00000000, 12); // every pixel takes the first colour
	return block;
}

/** A picture: a head of sixty four bytes and the blocks behind it. */
function gxtFile(input: {
	width: number;
	height: number;
	blocks: Buffer;
	format?: number;
	mark?: number;
	textureOffset?: number;
	textureLength?: number;
}): Buffer {
	const head = Buffer.alloc(0x40, 0x00);
	Buffer.from("GXT", "latin1").copy(head, 0);
	head.writeInt32LE(input.mark ?? 0x10000003, 4);
	const textureOffset = input.textureOffset ?? 0x40;
	head.writeUInt32LE(textureOffset, 0x20);
	head.writeInt32LE(input.textureLength ?? input.blocks.length, 0x24);
	head.writeInt32LE(0, 0x28);
	head.writeUInt32LE(0, 0x2c);
	head.writeUInt32LE(0x40000000, 0x30);
	head.writeUInt32LE(input.format ?? 0x87000000, 0x34);
	head.writeUInt16LE(input.width, 0x38);
	head.writeUInt16LE(input.height, 0x3a);
	const padding = Buffer.alloc(Math.max(0, textureOffset - 0x40), 0x00);
	return Buffer.concat([head, padding, input.blocks]);
}

/** The colour of the first pixel of a block of the picture. */
function pixelAt(pixels: Buffer, width: number, x: number, y: number): string {
	const at = (y * width + x) * 4;
	return pixels.subarray(at, at + 4).toString("hex");
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await criGxtImageFormat.open(
		new BufferByteSource(data),
		"tex.gxt",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("CRI Middleware image", () => {
	it("reads the head as the reference does", () => {
		const data = gxtFile({
			width: 4,
			height: 4,
			blocks: solidBlock(0xffff),
		});
		expect(readGxtLayout(data)).toEqual({
			width: 4,
			height: 4,
			textureOffset: 0x40,
			textureLength: 16,
			paletteIndex: 0,
			flags: 0,
			textureType: 0x40000000,
			textureFormat: 0x87000000,
		});
	});

	it("gates on the marks and the places", () => {
		const good = gxtFile({ width: 4, height: 4, blocks: solidBlock(0xffff) });
		expect(readGxtLayout(good)).toBeDefined();
		expect(
			readGxtLayout(
				gxtFile({
					width: 4,
					height: 4,
					blocks: solidBlock(0xffff),
					mark: 0x10000002,
				}),
			),
		).toBeUndefined();
		expect(
			readGxtLayout(
				gxtFile({ width: 0, height: 4, blocks: solidBlock(0xffff) }),
			),
		).toBeUndefined();
		// The blocks have to stand inside the file.
		expect(
			readGxtLayout(
				gxtFile({
					width: 4,
					height: 4,
					blocks: solidBlock(0xffff),
					textureLength: 0x100,
				}),
			),
		).toBeUndefined();
	});

	it("finds the highest bit of a number", () => {
		expect(bitScanReverse(0)).toBe(0);
		expect(bitScanReverse(1)).toBe(0);
		expect(bitScanReverse(2)).toBe(1);
		expect(bitScanReverse(3)).toBe(1);
		expect(bitScanReverse(4)).toBe(2);
		expect(bitScanReverse(16)).toBe(4);
	});

	it("turns the two places of a block around as the reference does", () => {
		// A picture of two by two blocks: what stands at the first place of a row of blocks moves to the
		// first place of a column of them, and the other way round.
		const places = [
			[0, 0],
			[1, 0],
			[0, 1],
			[1, 1],
		].map(([x, y]) => {
			const coords = swizzledCoords(x ?? 0, y ?? 0, 2, 2);
			return [coords.x, coords.y];
		});
		expect(places).toEqual([
			[0, 0],
			[0, 1],
			[1, 0],
			[1, 1],
		]);
		// A picture wider than it is tall reads the turned number as a column of blocks and a place in it.
		expect(swizzledCoords(0, 0, 4, 2)).toEqual({ x: 0, y: 0 });
		expect(swizzledCoords(1, 0, 4, 2)).toEqual({ x: 0, y: 1 });
		expect(swizzledCoords(2, 0, 4, 2)).toEqual({ x: 1, y: 0 });
		// The places above the two lowest pairs of the number stand as they are.
		expect(swizzledCoords(3, 1, 4, 2)).toEqual({ x: 3, y: 1 });
		// A direction with no blocks at all is taken to hold sixteen.
		expect(swizzledCoords(0, 0, 0, 0)).toEqual({ x: 0, y: 0 });
	});

	it("reads a picture of four blocks in the order the turning gives", async () => {
		// Four blocks of two by two, every one of them a colour of its own: white, red, green and blue.
		const blocks = Buffer.concat([
			solidBlock(0xffff),
			solidBlock(0xf800),
			solidBlock(0x07e0),
			solidBlock(0x001f),
		]);
		const data = gxtFile({ width: 8, height: 8, blocks });
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-8);
		const pixels = out.subarray(0x36);
		// The block behind the first place of the picture is white, the one behind the second place of the
		// first column is green, and so on.
		expect(pixelAt(pixels, 8, 0, 0)).toBe("ffffffff");
		expect(pixelAt(pixels, 8, 4, 0)).toBe("00ff00ff");
		expect(pixelAt(pixels, 8, 0, 4)).toBe("0000ffff");
		expect(pixelAt(pixels, 8, 4, 4)).toBe("ff0000ff");
	});

	it("turns a picture of another kind away", async () => {
		const data = gxtFile({
			width: 4,
			height: 4,
			blocks: solidBlock(0xffff),
			format: 0x85000000,
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"CRI Middleware picture of the kind 85000000 not supported",
		);
	});

	it("turns a picture cut short of its blocks away", () => {
		const data = gxtFile({ width: 8, height: 8, blocks: solidBlock(0xffff) });
		const layout = readGxtLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => unpackGxt(data, layout)).toThrow(
			"CRI Middleware picture is cut short of its blocks",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = gxtFile({ width: 4, height: 4, blocks: solidBlock(0xffff) });
		data.write("TXT", 0, "latin1");
		await expect(
			criGxtImageFormat.open(new BufferByteSource(data), "tex.gxt"),
		).rejects.toThrow(GarbroError);
		await expect(
			criGxtImageFormat.open(new BufferByteSource(data), "tex.gxt"),
		).rejects.toThrow("Not a CRI Middleware picture");
	});
});
