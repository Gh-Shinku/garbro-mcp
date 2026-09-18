import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	cgdKToolImageFormat,
	cgdSpielImageFormat,
	readCgdKToolLayout,
	readCgdSpielLayout,
} from "../../packages/formats/src/kapp/cgd-image.js";

/** A KApp picture: the outer head, the engine's inner head and the stream. */
function ktoolFile(input: {
	width: number;
	height: number;
	bpp: number;
	compression: number;
	pixels: Buffer;
	id?: number;
	offset?: number;
}): Buffer {
	const offset = input.offset ?? 0x18;
	const outer = Buffer.alloc(0x18);
	Buffer.from("ktool210", "latin1").copy(outer, 0);
	outer.writeInt32LE(1, 8);
	outer.writeUInt32LE(offset, 0x10);
	const inner = Buffer.alloc(0x20);
	inner.writeInt32LE(input.width * input.height * (input.bpp >> 3), 0x00);
	inner.writeUInt16LE(input.compression, 0x08);
	inner.writeUInt16LE(0x10, 0x0a);
	inner.writeUInt32LE(input.id ?? 0x973768, 0x0c);
	inner.writeUInt16LE(input.width, 0x10);
	inner.writeUInt16LE(input.height, 0x12);
	inner.writeUInt16LE(input.bpp, 0x14);
	return Buffer.concat([outer, inner, input.pixels]);
}

/** A Spiel picture: the head and the stream. */
function spielFile(input: {
	width: number;
	height: number;
	bpp: number;
	compression: number;
	pixels: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x20);
	Buffer.from("spiel100", "latin1").copy(head, 0);
	head.writeInt32LE(1, 8);
	head.writeUInt32LE(0x20, 0x10);
	head.writeUInt16LE(input.width, 0x18);
	head.writeUInt16LE(input.height, 0x1a);
	head.writeUInt8(input.bpp, 0x1e);
	head.writeUInt8(input.compression, 0x1f);
	return Buffer.concat([head, input.pixels]);
}

/** A run stream that writes `value` `count` times. */
function run(count: number, value: number): Buffer {
	if (count > 0x7f) throw new Error("a single run may not hold more than 127");
	return Buffer.from([count, value]);
}

/** A control that writes the given bytes as they stand, which a negative one means. */
function literalRun(values: number[]): Buffer {
	if (values.length === 0) return Buffer.alloc(0);
	if (values.length > 0x80)
		throw new Error("a single run may not hold more than 128");
	return Buffer.concat([
		Buffer.from([(0x100 - values.length) & 0xff]),
		Buffer.from(values.map((value) => value & 0xff)),
	]);
}

async function extract(
	format: typeof cgdKToolImageFormat,
	data: Buffer,
): Promise<Buffer> {
	const handle = await format.open(new BufferByteSource(data), "pic.cgd");
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("KApp compressed image", () => {
	it("reads the head as the reference does", () => {
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
		});
		expect(readCgdKToolLayout(data)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			dataOffset: 0x38,
			unpackedSize: 6,
			compression: 0,
			rgbOrder: true,
		});
	});

	it("gates on the mark, the version and the inner head", () => {
		const good = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
		});
		expect(readCgdKToolLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("ktool211", 0, "latin1");
		expect(readCgdKToolLayout(mark)).toBeUndefined();
		const version = Buffer.from(good);
		version.writeInt32LE(2, 8);
		expect(readCgdKToolLayout(version)).toBeUndefined();
		// The inner head has to carry one of the two words the reference knows.
		const id = Buffer.from(good);
		id.writeUInt32LE(0x123456, 0x18 + 0x0c);
		expect(readCgdKToolLayout(id)).toBeUndefined();
		// A depth without a layout of its own is turned away.
		const depth = Buffer.from(good);
		depth.writeUInt16LE(8, 0x18 + 0x14);
		expect(readCgdKToolLayout(depth)).toBeUndefined();
	});

	it("takes the place of the stream from the word at sixteen with its highest bit cleared", () => {
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
			offset: 0x18,
		});
		data.writeUInt32LE(0x80000018, 0x10);
		expect(readCgdKToolLayout(data)?.dataOffset).toBe(0x38);
	});

	it("writes a stored twenty four bit picture out again with its channels swapped", async () => {
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		});
		const out = await extract(cgdKToolImageFormat, data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-1);
		// `Rgb24` data has its red and blue bytes the other way round from a bitmap.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("3322116655440000");
	});

	it("writes a stored thirty two bit picture out again", async () => {
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 32,
			compression: 0,
			pixels: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66, 0x77, 0x88]),
		});
		const out = await extract(cgdKToolImageFormat, data);
		expect(out.readUInt16LE(0x1c)).toBe(32);
		expect(out.subarray(0x36).toString("hex")).toBe("1122334455667788");
	});

	it("unfolds two run streams a byte of the picture apart", async () => {
		const stream = Buffer.concat([
			literalRun([0x11, 0x22, 0x33]),
			Buffer.from([0x00]),
			literalRun([0x44, 0x55, 0x66]),
			Buffer.from([0x00]),
		]);
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 2,
			pixels: stream,
		});
		const out = await extract(cgdKToolImageFormat, data);
		// The two streams fill the place of every other byte, and the channels of every pixel are swapped.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("2244116633550000");
	});

	it("unfolds a picture written as four run streams", async () => {
		const stream = Buffer.concat([
			run(2, 0xaa),
			Buffer.from([0x00]),
			run(2, 0xbb),
			Buffer.from([0x00]),
			run(2, 0xcc),
			Buffer.from([0x00]),
			run(2, 0xdd),
			Buffer.from([0x00]),
		]);
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 32,
			compression: 4,
			pixels: stream,
		});
		const out = await extract(cgdKToolImageFormat, data);
		expect(out.subarray(0x36).toString("hex")).toBe("aabbccddaabbccdd");
	});

	it("unfolds a picture written as one run stream of literals", async () => {
		const values = [0x11, 0x22, 0x33, 0x44, 0x55, 0x66];
		const stream = Buffer.concat([literalRun(values), Buffer.from([0x00])]);
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 1,
			pixels: stream,
		});
		const out = await extract(cgdKToolImageFormat, data);
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("3322116655440000");
	});

	it("unfolds a picture behind the engine's Huffman", async () => {
		// A dictionary with one leaf of weight five, the rest of nothing, and the extra leaf of weight one.
		const dictionary = Buffer.concat([
			run(0x41, 0x00),
			run(1, 0x05),
			run(0x7f, 0x00),
			run(0x3f, 0x00),
			Buffer.from([0x00]),
		]);
		// The leaf of weight one stands on the left, so a clear bit is the extra leaf and a set bit is 'A'.
		const stream = Buffer.concat([dictionary, Buffer.from([0xaa, 0xaa])]);
		const data = ktoolFile({
			width: 2,
			height: 2,
			bpp: 32,
			compression: 0x10,
			pixels: stream,
		});
		const out = await extract(cgdKToolImageFormat, data);
		expect(out.subarray(0x36).toString("hex")).toBe(
			"41004100410041004100410041004100",
		);
	});

	it("refuses a compression it does not know", async () => {
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0x20,
			pixels: Buffer.alloc(6),
		});
		const handle = await cgdKToolImageFormat.open(
			new BufferByteSource(data),
			"pic.cgd",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow(
			"compression this reader does not know",
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const data = ktoolFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
		});
		data.write("ktool211", 0, "latin1");
		await expect(
			cgdKToolImageFormat.open(new BufferByteSource(data), "pic.cgd"),
		).rejects.toThrow("Not a KApp picture");
	});
});

describe("Spiel compressed image", () => {
	it("reads the head as the reference does", () => {
		const data = spielFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
		});
		expect(readCgdSpielLayout(data)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			dataOffset: 0x20,
			unpackedSize: 6,
			compression: 0,
			rgbOrder: false,
		});
	});

	it("gates on the mark, the version and the place of the stream", () => {
		const good = spielFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
		});
		expect(readCgdSpielLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("spiel101", 0, "latin1");
		expect(readCgdSpielLayout(mark)).toBeUndefined();
		const version = Buffer.from(good);
		version.writeInt32LE(3, 8);
		expect(readCgdSpielLayout(version)).toBeUndefined();
		const shallow = Buffer.from(good);
		shallow.writeUInt32LE(0x10, 0x10);
		expect(readCgdSpielLayout(shallow)).toBeUndefined();
	});

	it("writes a stored twenty four bit picture out again", async () => {
		const data = spielFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.from([0x11, 0x22, 0x33, 0x44, 0x55, 0x66]),
		});
		const out = await extract(cgdSpielImageFormat, data);
		expect(out.readUInt16LE(0x1c)).toBe(24);
		// `Bgr24` data stands the way a bitmap holds it.
		expect(out.subarray(0x36, 0x3e).toString("hex")).toBe("1122334455660000");
	});

	it("unfolds a picture written as four run streams", async () => {
		const stream = Buffer.concat([
			run(2, 0x11),
			Buffer.from([0x00]),
			run(2, 0x22),
			Buffer.from([0x00]),
			run(2, 0x33),
			Buffer.from([0x00]),
			run(2, 0x44),
			Buffer.from([0x00]),
		]);
		const data = spielFile({
			width: 2,
			height: 1,
			bpp: 32,
			compression: 4,
			pixels: stream,
		});
		const out = await extract(cgdSpielImageFormat, data);
		expect(out.subarray(0x36).toString("hex")).toBe("1122334411223344");
	});

	it("declines a file that does not hold a picture", async () => {
		const data = spielFile({
			width: 2,
			height: 1,
			bpp: 24,
			compression: 0,
			pixels: Buffer.alloc(6),
		});
		data.write("spiel101", 0, "latin1");
		await expect(
			cgdSpielImageFormat.open(new BufferByteSource(data), "pic.cgd"),
		).rejects.toThrow("Not a Spiel picture");
	});
});
