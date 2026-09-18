import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	applyPrtAlpha,
	kidPrtImageFormat,
	readPrtLayout,
} from "../../packages/formats/src/kid/prt-image.js";

/** A colour map whose entry is the entry's own number spread over three bytes. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x400, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		palette[entry * 4] = entry;
		palette[entry * 4 + 1] = (entry + 1) & 0xff;
		palette[entry * 4 + 2] = (entry + 2) & 0xff;
	}
	return palette;
}

/** A picture: the head, the colour map when there is one, the pixels and the plane of fourth bytes. */
function prtFile(input: {
	width: number;
	height: number;
	bpp: number;
	version?: number;
	pixels: Buffer;
	alpha?: Buffer;
}): Buffer {
	const version = input.version ?? 101;
	const headSize = 102 === version ? 0x1c : 0x14;
	const hasPalette = 8 === input.bpp;
	const head = Buffer.alloc(headSize, 0x00);
	Buffer.from("PRT\0", "latin1").copy(head, 0);
	head.writeUInt16LE(version, 4);
	head.writeUInt16LE(input.bpp, 6);
	head.writeUInt16LE(hasPalette ? headSize : 0, 8);
	head.writeUInt16LE(headSize + (hasPalette ? 0x400 : 0), 0x0a);
	head.writeUInt16LE(input.width, 0x0c);
	head.writeUInt16LE(input.height, 0x0e);
	head.writeInt32LE(input.alpha ? 1 : 0, 0x10);
	return Buffer.concat([
		head,
		hasPalette ? paletteBytes() : Buffer.alloc(0),
		input.pixels,
		input.alpha ?? Buffer.alloc(0),
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await kidPrtImageFormat.open(
		new BufferByteSource(data),
		"pic.prt",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("KID image", () => {
	it("reads the head as the reference does", () => {
		const data = prtFile({
			width: 2,
			height: 2,
			bpp: 24,
			pixels: Buffer.alloc(16),
		});
		expect(readPrtLayout(data)).toMatchObject({
			version: 101,
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			stride: 8,
			hasAlpha: false,
			alphaOffset: 0x14 + 16,
		});
	});

	it("gates on the word, the version, the depth and the places", () => {
		const good = prtFile({
			width: 2,
			height: 2,
			bpp: 24,
			pixels: Buffer.alloc(16),
		});
		expect(readPrtLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("PRU\0", 0, "latin1");
		expect(readPrtLayout(mark)).toBeUndefined();
		// Only the two versions the reference knows are read.
		const version = Buffer.from(good);
		version.writeUInt16LE(100, 4);
		expect(readPrtLayout(version)).toBeUndefined();
		const depth = Buffer.from(good);
		depth.writeUInt16LE(16, 6);
		expect(readPrtLayout(depth)).toBeUndefined();
		// The pixels have to stand inside the file.
		const short = Buffer.from(good.subarray(0, 0x20));
		expect(readPrtLayout(short)).toBeUndefined();
		// The second version carries a pair of offsets behind the head.
		const second = prtFile({
			width: 2,
			height: 2,
			bpp: 24,
			version: 102,
			pixels: Buffer.alloc(16),
		});
		expect(readPrtLayout(second)).toMatchObject({ version: 102 });
	});

	it("takes the fourth byte of every pixel from its own plane and turns the rows", () => {
		const data = prtFile({
			width: 2,
			height: 2,
			bpp: 24,
			pixels: Buffer.from([
				0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x00, 0x00, 0x77, 0x88, 0x99, 0xaa,
				0xbb, 0xcc, 0x00, 0x00,
			]),
			alpha: Buffer.from([1, 2, 3, 4]),
		});
		const layout = readPrtLayout(data);
		if (!layout) throw new Error("no layout");
		// The walk of the reader begins at the lowest row of the stored pixels, so the picture is turned.
		expect(applyPrtAlpha(data, layout).toString("hex")).toBe(
			"77889901aabbcc021122330344556604",
		);
	});

	it("writes a twenty four bit picture out again", async () => {
		const out = await extract(
			prtFile({
				width: 2,
				height: 2,
				bpp: 24,
				pixels: Buffer.from([
					0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x00, 0x00, 0x77, 0x88, 0x99,
					0xaa, 0xbb, 0xcc, 0x00, 0x00,
				]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `CreateFlipped` stores rows bottom up, so the bitmap height stays positive.
		expect(out.readInt32LE(0x16)).toBe(2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"1122334455660000778899aabbcc0000",
		);
	});

	it("writes a picture with a plane of fourth bytes out as a thirty two bit one", async () => {
		const out = await extract(
			prtFile({
				width: 2,
				height: 2,
				bpp: 24,
				pixels: Buffer.from([
					0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x00, 0x00, 0x77, 0x88, 0x99,
					0xaa, 0xbb, 0xcc, 0x00, 0x00,
				]),
				alpha: Buffer.from([1, 2, 3, 4]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// The reader turns the rows itself, so the bitmap is top down.
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"77889901aabbcc021122330344556604",
		);
	});

	it("writes an eight bit picture out with its colour map", async () => {
		const out = await extract(
			prtFile({
				width: 2,
				height: 1,
				bpp: 8,
				pixels: Buffer.from([0x01, 0x02, 0x00, 0x00]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.readUInt32LE(0x2e)).toBe(256);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("0001020001020300");
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("01020000");
	});

	it("writes a thirty two bit picture out again", async () => {
		const out = await extract(
			prtFile({
				width: 2,
				height: 1,
				bpp: 32,
				pixels: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(0x36).toString("hex")).toBe("1122334455667788");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = prtFile({
			width: 2,
			height: 1,
			bpp: 24,
			pixels: Buffer.alloc(8),
		});
		data.write("PRU\0", 0, "latin1");
		await expect(
			kidPrtImageFormat.open(new BufferByteSource(data), "pic.prt"),
		).rejects.toThrow(GarbroError);
		await expect(
			kidPrtImageFormat.open(new BufferByteSource(data), "pic.prt"),
		).rejects.toThrow("Not a KID picture");
	});
});
