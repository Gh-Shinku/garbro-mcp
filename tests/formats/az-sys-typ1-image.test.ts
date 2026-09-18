import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	azSysTyp1ImageFormat,
	readTyp1Layout,
	readTyp1Palette,
	unpackTyp1,
} from "../../packages/formats/src/azsys/typ1-image.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
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

/** A picture whose pixels stand in one stream. */
function packedFile(input: {
	width: number;
	height: number;
	bpp: number;
	pixels: Buffer;
	palette?: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x0e, 0x00);
	Buffer.from("TYP1", "latin1").copy(head, 0);
	head.writeUInt8(input.bpp, 4);
	head.writeUInt8(input.palette ? 1 : 0, 5);
	head.writeUInt16LE(input.width, 6);
	head.writeUInt16LE(input.height, 8);
	const body = deflateSync(input.pixels);
	head.writeUInt32LE(body.length, 0x0a);
	return Buffer.concat([head, input.palette ?? Buffer.alloc(0), body]);
}

/** A stream of a picture of a colour: four bytes of a checksum and then the stream itself. */
function streamOf(bytes: Buffer): Buffer {
	return Buffer.concat([Buffer.alloc(4, 0x00), deflateSync(bytes)]);
}

/** A picture whose pixels stand in four streams of their own. */
function channelFile(input: {
	width: number;
	height: number;
	bpp: number;
	hasPalette?: boolean;
	/** The four streams in the order the head gives them, every one of them or nothing at all. */
	streams: Array<Buffer>;
	palette?: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x1e, 0x00);
	Buffer.from("TYP1", "latin1").copy(head, 0);
	head.writeUInt8(input.bpp, 4);
	head.writeUInt8(input.hasPalette ? 1 : 0, 5);
	head.writeUInt16LE(input.width, 6);
	head.writeUInt16LE(input.height, 8);
	// What the walk of the four streams counts is the size of every stream, in the order of the head.
	input.streams.forEach((stream, index) => {
		head.writeUInt32LE(stream.length, 0x0e + index * 4);
	});
	// The streams themselves stand in the order the walk takes them in: the fourth, the third, the second
	// and the first.
	const body = [3, 2, 1, 0].flatMap((index) => {
		const stream = input.streams[index] ?? Buffer.alloc(0);
		return stream.length === 0 ? [] : [stream];
	});
	return Buffer.concat([
		head,
		input.palette ?? Buffer.alloc(0),
		Buffer.concat(body),
	]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await azSysTyp1ImageFormat.open(
		new BufferByteSource(data),
		"pic.typ",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("AZ system image", () => {
	it("reads a head whose pixels stand in one stream", () => {
		const data = packedFile({
			width: 2,
			height: 1,
			bpp: 32,
			pixels: Buffer.alloc(8, 0x00),
		});
		expect(readTyp1Layout(data)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			hasPalette: false,
			separateChannels: false,
			packedSize: data.length - 0x0e,
			channels: [0, 0, 0, 0],
		});
	});

	it("reads a head whose pixels stand in four streams", () => {
		const data = channelFile({
			width: 2,
			height: 1,
			bpp: 32,
			streams: [
				streamOf(Buffer.alloc(2, 0x00)),
				streamOf(Buffer.alloc(2, 0x00)),
				streamOf(Buffer.alloc(2, 0x00)),
				streamOf(Buffer.alloc(2, 0x00)),
			],
		});
		expect(readTyp1Layout(data)).toMatchObject({
			width: 2,
			height: 1,
			bitsPerPixel: 32,
			separateChannels: true,
			hasPalette: false,
		});
		expect(readTyp1Layout(data)?.channels[0]).toBeGreaterThan(0);
	});

	it("gates on the mark and the sizes", () => {
		const good = packedFile({
			width: 2,
			height: 1,
			bpp: 32,
			pixels: Buffer.alloc(8, 0x00),
		});
		expect(readTyp1Layout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("TYP2", 0, "latin1");
		expect(readTyp1Layout(mark)).toBeUndefined();
		const width = Buffer.from(good);
		width.writeUInt16LE(0, 6);
		expect(readTyp1Layout(width)).toBeUndefined();
	});

	it("reads a picture of thirty two bits a pixel from one stream", async () => {
		const pixels = Buffer.from([
			0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
		]);
		const out = await extract(
			packedFile({ width: 2, height: 1, bpp: 32, pixels }),
		);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down, so the height of the bitmap is negative.
		expect(out.readInt32LE(0x16)).toBe(-1);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			pixels.toString("hex"),
		);
	});

	it("reads an eight bit picture with a colour map from one stream", async () => {
		const out = await extract(
			packedFile({
				width: 2,
				height: 1,
				bpp: 8,
				pixels: Buffer.from([0x01, 0x02]),
				palette: paletteBytes(),
			}),
		);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3a).toString("hex")).toBe("00102000");
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("01020000");
	});

	it("reads an eight bit picture without a colour map as grey", async () => {
		// A picture whose pixels stand in streams of their own names its colour map with a byte of its head,
		// and where that byte is nought the picture stands alone: what a bitmap then carries is the map of
		// greys, a place over and over for every one of the two hundred and fifty six entries.
		const head = channelFile({
			width: 2,
			height: 1,
			bpp: 8,
			streams: [
				Buffer.alloc(0),
				Buffer.alloc(0),
				Buffer.alloc(0),
				Buffer.alloc(0),
			],
		});
		const data = Buffer.concat([
			head.subarray(0, 0x1e),
			streamOf(Buffer.from([0x01, 0x02])),
		]);
		const layout = readTyp1Layout(data);
		if (!layout) throw new Error("no layout");
		expect(layout).toMatchObject({
			separateChannels: true,
			hasPalette: false,
		});
		const picture = await unpackTyp1(data, layout);
		expect(picture.pixels.subarray(0, 2).toString("hex")).toBe("0102");
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(8);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0, 0, 0, 0, 1, 1, 1, 0]),
		);
		expect(out.subarray(0x436, 0x43a).toString("hex")).toBe("01020000");
	});

	it("reads an eight bit picture from its own stream", async () => {
		const data = channelFile({
			width: 2,
			height: 1,
			bpp: 8,
			hasPalette: true,
			palette: paletteBytes(),
			streams: [
				Buffer.alloc(0),
				Buffer.alloc(0),
				Buffer.alloc(0),
				Buffer.alloc(0),
			],
		});
		// The one stream of an eight bit picture stands four bytes of a checksum behind the colour map.
		const body = Buffer.concat([
			data.subarray(0, 0x1e + 0x400),
			streamOf(Buffer.from([0x01, 0x02])),
		]);
		const layout = readTyp1Layout(body);
		if (!layout) throw new Error("no layout");
		expect(layout.separateChannels).toBe(true);
		const picture = await unpackTyp1(body, layout);
		expect(picture.pixels.subarray(0, 2).toString("hex")).toBe("0102");
		expect(readTyp1Palette(body, layout).subarray(0, 4).toString("hex")).toBe(
			"00102000",
		);
	});

	it("reads a picture of a colour from four streams of its own", async () => {
		// Three streams of a colour, one byte a pixel every one of them.
		const data = channelFile({
			width: 2,
			height: 1,
			bpp: 24,
			streams: [
				streamOf(Buffer.from([0x30, 0x31])), // the third byte of a pixel
				streamOf(Buffer.from([0x20, 0x21])), // the second
				streamOf(Buffer.from([0x10, 0x11])), // the first
				Buffer.alloc(0),
			],
		});
		const layout = readTyp1Layout(data);
		if (!layout) throw new Error("no layout");
		const picture = await unpackTyp1(data, layout);
		// Every stream writes its own byte of the pixel, so the two pixels are the three bytes of colour
		// with the fourth standing as nought.
		expect(picture.pixels.toString("hex")).toBe(
			hex([0x10, 0x20, 0x30, 0, 0x11, 0x21, 0x31, 0]),
		);
		const out = await extract(data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([0x10, 0x20, 0x30, 0, 0x11, 0x21, 0x31, 0]),
		);
	});

	it("reads four streams of a picture with alpha", async () => {
		const data = channelFile({
			width: 1,
			height: 1,
			bpp: 32,
			streams: [
				streamOf(Buffer.from([0x30])),
				streamOf(Buffer.from([0x20])),
				streamOf(Buffer.from([0x10])),
				streamOf(Buffer.from([0x40])),
			],
		});
		const layout = readTyp1Layout(data);
		if (!layout) throw new Error("no layout");
		const picture = await unpackTyp1(data, layout);
		// The fourth stream writes the fourth byte of the pixel.
		expect(picture.pixels.toString("hex")).toBe(hex([0x10, 0x20, 0x30, 0x40]));
	});

	it("turns a picture of an impossible depth away", async () => {
		const data = packedFile({
			width: 2,
			height: 1,
			bpp: 16,
			pixels: Buffer.alloc(8, 0x00),
		});
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"AZ system picture of an impossible colour depth",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = packedFile({
			width: 2,
			height: 1,
			bpp: 32,
			pixels: Buffer.alloc(8, 0x00),
		});
		data.write("TYP2", 0, "latin1");
		await expect(
			azSysTyp1ImageFormat.open(new BufferByteSource(data), "pic.typ"),
		).rejects.toThrow(GarbroError);
		await expect(
			azSysTyp1ImageFormat.open(new BufferByteSource(data), "pic.typ"),
		).rejects.toThrow("Not an AZ system picture");
	});
});
