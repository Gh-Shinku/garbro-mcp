import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	aquariumCp2ImageFormat,
	readCp2Layout,
	readCp2Palette,
	unpackCp2,
	unpackCp2Lz,
} from "../../packages/formats/src/aquarium/cp2-image.js";

/** How many bytes a row of the picture stands at. */
function strideOf(width: number, bpp: number): number {
	return (((width + 31) & ~31) * bpp) / 8;
}

/** A picture: the head, an optional colour map and then the pixels. */
function cp2File(input: {
	width: number;
	height: number;
	bpp: number;
	flags?: number;
	palette?: Buffer;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x20, 0x00);
	Buffer.from("CP2", "latin1").copy(head, 0);
	head.writeUInt32LE(input.width, 4);
	head.writeUInt32LE(input.height, 8);
	head.writeInt32LE(input.bpp, 0x0c);
	head.writeInt32LE(input.flags ?? 0, 0x14);
	return Buffer.concat([head, input.palette ?? Buffer.alloc(0), input.body]);
}

/** A walk of runs: two words and then the runs themselves. */
function walk(remaining: number, bytes: number[]): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.writeInt32LE(remaining, 0);
	head.writeInt32LE(0, 4);
	return Buffer.concat([head, Buffer.from(bytes)]);
}

/** A colour map of two hundred and fifty six entries of four bytes. */
function paletteBytes(): Buffer {
	const palette = Buffer.alloc(0x400, 0x00);
	for (let entry = 0; entry < 0x100; entry += 1) {
		palette[entry * 4] = entry;
		palette[entry * 4 + 1] = 0x10;
		palette[entry * 4 + 2] = 0x20;
	}
	return palette;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await aquariumCp2ImageFormat.open(
		new BufferByteSource(data),
		"pic.cp2",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Aquarium image", () => {
	it("reads the head as the reference does", () => {
		expect(
			readCp2Layout(
				cp2File({
					width: 2,
					height: 1,
					bpp: 24,
					body: Buffer.alloc(strideOf(2, 24), 0x00),
				}),
			),
		).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			flags: 0,
			isCompressed: false,
			hasAlpha: false,
			stride: strideOf(2, 24),
		});
		// The four lower places of the flags mean a walk of its own, the place 0x20 a plane of fourth bytes.
		const flagged = readCp2Layout(
			cp2File({
				width: 2,
				height: 1,
				bpp: 24,
				flags: 0x21,
				body: Buffer.alloc(strideOf(2, 24) + 32, 0x00),
			}),
		);
		expect(flagged).toMatchObject({ isCompressed: true, hasAlpha: true });
	});

	it("gates on the mark, the depth and the sizes", () => {
		const good = cp2File({
			width: 2,
			height: 1,
			bpp: 24,
			body: Buffer.alloc(strideOf(2, 24), 0x00),
		});
		expect(readCp2Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("XP2", 0, "latin1");
		expect(readCp2Layout(mark)).toBeUndefined();
		expect(
			readCp2Layout(
				cp2File({ width: 2, height: 1, bpp: 16, body: Buffer.alloc(64, 0x00) }),
			),
		).toBeUndefined();
		expect(
			readCp2Layout(
				cp2File({ width: 0, height: 1, bpp: 24, body: Buffer.alloc(64, 0x00) }),
			),
		).toBeUndefined();
	});

	it("walks a stream of runs", () => {
		const output = Buffer.alloc(6, 0x00);
		// Two bytes that stand as they are, a run of two bytes reaching back to the first of them, and a
		// nought that stands for a single byte of nought.
		const stream = walk(8, [0x11, 0x22, 0x00, 0x02, 0x02, 0x00, 0x00, 0x00]);
		unpackCp2Lz(stream, 0, output);
		expect(output.toString("hex")).toBe("112211220000");
	});

	it("reads the pixels as they stand where there is no walk", async () => {
		const stride = strideOf(2, 24);
		const body = Buffer.alloc(stride, 0x00);
		body.writeUInt8(0x10, 0);
		body.writeUInt8(0x20, 1);
		body.writeUInt8(0x30, 2);
		body.writeUInt8(0x11, 3);
		body.writeUInt8(0x21, 4);
		body.writeUInt8(0x31, 5);
		const out = await extract(cp2File({ width: 2, height: 1, bpp: 24, body }));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// The picture is flipped by the reference, so the rows of the bitmap stand bottom up.
		expect(out.readInt32LE(0x16)).toBe(1);
		// The row of the picture stands thirty two bytes wide, the row of the bitmap six.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1020301121310000");
	});

	it("reads a picture that stands behind a walk", async () => {
		const stride = strideOf(1, 24);
		const values = Array.from({ length: stride }, (_, index) => index + 1);
		const body = walk(stride, values);
		const out = await extract(
			cp2File({ width: 1, height: 1, bpp: 24, flags: 1, body }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("01020300");
	});

	it("reads an eight bit picture with its colour map", async () => {
		const stride = strideOf(2, 8);
		const body = Buffer.alloc(stride, 0x00);
		body.writeUInt8(0x01, 0);
		body.writeUInt8(0x02, 1);
		const out = await extract(
			cp2File({
				width: 2,
				height: 1,
				bpp: 8,
				palette: paletteBytes(),
				body,
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("00102000");
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("01020000");
	});

	it("weaves a plane of fourth bytes into the pixels", async () => {
		// Two rows of two pixels, the colour rows standing bottom up and the plane of fourth bytes top down.
		const stride = strideOf(2, 24);
		const body = Buffer.alloc(stride * 2, 0x00);
		// The last row of the picture, which is the first row of the bitmap.
		body.writeUInt8(0x40, stride);
		body.writeUInt8(0x50, stride + 1);
		body.writeUInt8(0x60, stride + 2);
		body.writeUInt8(0x41, stride + 3);
		body.writeUInt8(0x51, stride + 4);
		body.writeUInt8(0x61, stride + 5);
		// The first row of the picture.
		body.writeUInt8(0x10, 0);
		body.writeUInt8(0x20, 1);
		body.writeUInt8(0x30, 2);
		body.writeUInt8(0x11, 3);
		body.writeUInt8(0x21, 4);
		body.writeUInt8(0x31, 5);
		const aligned = stride / 3;
		const alpha = Buffer.alloc(aligned * 2, 0x00);
		alpha.writeUInt8(0x80, 0);
		alpha.writeUInt8(0x81, 1);
		alpha.writeUInt8(0x90, aligned);
		alpha.writeUInt8(0x91, aligned + 1);
		const data = cp2File({
			width: 2,
			height: 2,
			bpp: 24,
			flags: 0x20,
			body: Buffer.concat([body, alpha]),
		});
		const layout = readCp2Layout(data);
		if (!layout) throw new Error("no layout");
		const picture = unpackCp2(data, layout);
		expect(picture.bitsPerPixel).toBe(32);
		// The colour rows are walked from the last of them while the fourth bytes are walked from the first.
		expect(picture.pixels.toString("hex")).toBe(
			"4050608041516181" + "1020309011213191",
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// What the reference weaves stands top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-2);
		expect(out.subarray(0x36, 0x46).toString("hex")).toBe(
			"40506080415161811020309011213191",
		);
	});

	it("reads the colour map as it stands", () => {
		const data = cp2File({
			width: 2,
			height: 1,
			bpp: 8,
			palette: paletteBytes(),
			body: Buffer.alloc(strideOf(2, 8), 0x00),
		});
		const layout = readCp2Layout(data);
		if (!layout) throw new Error("no layout");
		expect(readCp2Palette(data, layout).toString("hex")).toBe(
			paletteBytes().toString("hex"),
		);
	});

	it("declines a walk that reaches behind the beginning of the pixels", () => {
		const output = Buffer.alloc(4, 0x00);
		const stream = walk(6, [0x11, 0x00, 0x02, 0x05, 0x00]);
		expect(() => unpackCp2Lz(stream, 0, output)).toThrow(GarbroError);
		expect(() => unpackCp2Lz(stream, 0, output)).toThrow(
			"Aquarium picture copies from before the beginning of its own pixels",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = cp2File({
			width: 2,
			height: 1,
			bpp: 24,
			body: Buffer.alloc(strideOf(2, 24), 0x00),
		});
		data.write("XP2", 0, "latin1");
		await expect(
			aquariumCp2ImageFormat.open(new BufferByteSource(data), "pic.cp2"),
		).rejects.toThrow(GarbroError);
		await expect(
			aquariumCp2ImageFormat.open(new BufferByteSource(data), "pic.cp2"),
		).rejects.toThrow("Not an Aquarium picture");
	});
});
