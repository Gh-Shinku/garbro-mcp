import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	kirikiriTlgImageFormat,
	readTlgLayout,
	unpackTlg5,
} from "../../packages/formats/src/kirikiri/tlg-image.js";

const HEAD_SIZE = 0x26;
const DATA_OFFSET_5 = 20;
const DATA_OFFSET_6 = 23;

/** The places of the picture of the words of the head of a picture of the fifth kind of the places of the
 * picture. */
function head5(options: {
	colors: number;
	width: number;
	height: number;
	kind?: string;
	maskWidth?: boolean;
	maskHeight?: boolean;
}): Buffer {
	const out = Buffer.alloc(DATA_OFFSET_5, 0x00);
	out.write(options.kind ?? "TLG5.0", 0, "latin1");
	out.write("\0raw\x1a", 6, "latin1");
	out[11] = options.colors;
	out.writeUInt32LE(
		options.maskWidth ? (options.width ^ 0xab) >>> 0 : options.width,
		12,
	);
	out.writeUInt32LE(
		options.maskHeight ? (options.height ^ 0xac) >>> 0 : options.height,
		16,
	);
	return out;
}

/** The places of the picture of the words of the head of a picture of the sixth kind of the places of the
 * picture. */
function head6(colors: number, width: number, height: number): Buffer {
	const out = Buffer.alloc(DATA_OFFSET_6, 0x00);
	out.write("TLG6.0", 0, "latin1");
	out.write("\0raw\x1a", 6, "latin1");
	out[11] = colors;
	out.writeUInt32LE(width, 15);
	out.writeUInt32LE(height, 19);
	return out;
}

/** The places of the picture of the walk of the places of the picture of the picture of the walk of them of
 * the places of the picture of the walk of the places of the picture of the fifth kind: the places of the
 * picture of the walk of the places of the picture of the place of the picture of the walk of them, the
 * places of the picture of the walk of the places of the picture standing as they stand, and the places of
 * the picture of the walk of the places of the picture of the words of the walk of the picture. */
function block(planes: { raw?: Buffer; lzss?: Buffer }[]): Buffer {
	const parts: Buffer[] = [];
	for (const plane of planes) {
		const payload = plane.raw ?? plane.lzss ?? Buffer.alloc(0);
		const head = Buffer.alloc(5, 0x00);
		head[0] = plane.raw ? 1 : 0;
		head.writeInt32LE(payload.length, 1);
		parts.push(head, payload);
	}
	return Buffer.concat(parts);
}

function picture(
	options: {
		colors: number;
		width: number;
		height: number;
		kind?: string;
		mask?: boolean;
	},
	blocks: Buffer,
	blockHeight = 1,
): Buffer {
	const blockCount = Math.floor((options.height - 1) / blockHeight) + 1;
	const sizes = Buffer.alloc(blockCount * 4, 0x00);
	const start = Buffer.alloc(4, 0x00);
	start.writeInt32LE(blockHeight, 0);
	const head = head5({
		colors: options.colors,
		width: options.width,
		height: options.height,
		kind: options.kind ?? "TLG5.0",
		maskWidth: options.mask ?? false,
		maskHeight: options.mask ?? false,
	});
	const body = Buffer.concat([start, sizes, blocks]);
	return Buffer.concat([
		head,
		body,
		Buffer.alloc(Math.max(0, HEAD_SIZE - head.length - body.length), 0x00),
	]);
}

describe("KiriKiri game engine image format", () => {
	it("reads the words of the head of a picture of the fifth kind of the places of the picture", () => {
		const file = picture(
			{ colors: 3, width: 2, height: 1 },
			block([
				{ raw: Buffer.from([0x10, 0x20]) },
				{ raw: Buffer.from([0x20, 0x30]) },
				{ raw: Buffer.from([0x30, 0x40]) },
			]),
		);
		expect(readTlgLayout(file, file.length)).toEqual({
			version: 5,
			colors: 3,
			bitsPerPixel: 24,
			width: 2,
			height: 1,
			dataOffset: DATA_OFFSET_5,
		});
	});

	it("reads the words of the head of a picture of the sixth kind of the places of the picture", () => {
		const file = Buffer.concat([head6(4, 3, 2), Buffer.alloc(HEAD_SIZE)]);
		expect(readTlgLayout(file, file.length)).toEqual({
			version: 6,
			colors: 4,
			bitsPerPixel: 32,
			width: 3,
			height: 2,
			dataOffset: DATA_OFFSET_6,
		});
		const first = Buffer.from(file);
		first[11] = 3;
		expect(readTlgLayout(first, first.length)?.colors).toBe(3);
		const bad = Buffer.from(file);
		bad[11] = 2;
		expect(readTlgLayout(bad, bad.length)).toBeUndefined();
	});

	it("reads the words of the head of a picture of the places of the picture of the sound of the kinds of the places of the picture of the words of the walk of the picture", () => {
		// The reference stands the places of the picture of the walk of the places of the picture of the kind
		// of the places of the picture of the walk of them of the places of the picture of the fifth kind of
		// the places of the picture where the places of the picture of the walk of the places of the picture
		// stand of the places of the picture of the walk of the places of the picture of their own.
		const file = picture(
			{ colors: 3, width: 2, height: 1, kind: "XXXYYY", mask: true },
			block([
				{ raw: Buffer.from([0x10, 0x20]) },
				{ raw: Buffer.from([0x20, 0x30]) },
				{ raw: Buffer.from([0x30, 0x40]) },
			]),
		);
		const layout = readTlgLayout(file, file.length);
		expect(layout?.version).toBe(5);
		expect(layout?.width).toBe(2);
		expect(layout?.height).toBe(1);
	});

	it("turns away the words of the head of a picture of the kinds of the places of the picture of no places of the picture of the walk of them", () => {
		const good = picture(
			{ colors: 3, width: 2, height: 1 },
			block([
				{ raw: Buffer.from([0x10, 0x20]) },
				{ raw: Buffer.from([0x20, 0x30]) },
				{ raw: Buffer.from([0x30, 0x40]) },
			]),
		);
		const wrongKind = Buffer.from(good);
		wrongKind.write("TLG7.0", 0, "latin1");
		expect(readTlgLayout(wrongKind, wrongKind.length)).toBeUndefined();
		const wrongRaw = Buffer.from(good);
		wrongRaw.write("\0rax\x1a", 6, "latin1");
		expect(readTlgLayout(wrongRaw, wrongRaw.length)).toBeUndefined();
		const fewColors = Buffer.from(good);
		fewColors[11] = 2;
		expect(readTlgLayout(fewColors, fewColors.length)).toBeUndefined();
		const noPlaces = Buffer.from(good);
		noPlaces.writeUInt32LE(0, 12);
		expect(readTlgLayout(noPlaces, noPlaces.length)).toBeUndefined();
		expect(readTlgLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them that stand as they stand", () => {
		// The places of the picture of the walk of the places of the picture stand of the places of the
		// picture of the walk of the places of the picture of the place of the picture of the walk of them,
		// and stand beside the places of the picture of the walk of the places of the picture of the picture
		// behind them.
		const file = picture(
			{ colors: 3, width: 2, height: 1 },
			block([
				{ raw: Buffer.from([0x10, 0x20]) },
				{ raw: Buffer.from([0x20, 0x30]) },
				{ raw: Buffer.from([0x30, 0x40]) },
			]),
		);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg5(file, layout);
		// The places of the picture of the walk of the places of the picture of the picture of the walk of
		// them stand of the places of the picture of the walk of the places of the picture of the place of the
		// picture of the walk of them, and of the places of the picture of the walk of the places of the
		// picture of the place of the picture of the walk of them of the places of the picture behind them.
		expect(bits.subarray(0, 4)).toEqual(Buffer.from([0x30, 0x20, 0x50, 0xff]));
		expect(bits.subarray(4, 8)).toEqual(Buffer.from([0x80, 0x50, 0xc0, 0xff]));
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture", () => {
		// The places of the picture of the walk of the places of the picture of the picture of the walk of
		// them stand of the places of the picture of the walk of the places of the picture of the words of
		// the walk of the picture, the places of the picture of the walk of the places of the picture of the
		// walk of them standing of the places of the picture of the walk of the places of the picture of the
		// places of the picture of the walk of them of the places of the picture of their own.
		const literals = Buffer.from([
			0x00, 0x10, 0x20, 0x30, 0x40, 0x50, 0x60, 0x70, 0x80,
		]);
		const plane = { lzss: literals };
		const file = picture(
			{ colors: 3, width: 3, height: 1 },
			block([plane, plane, plane]),
		);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg5(file, layout);
		// The places of the picture of the walk of the places of the picture stand as they stand, and the
		// places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them stand of the places of the picture of the walk of the places of the picture of the
		// place of the picture of the walk of them of the places of the picture of the walk of them.
		expect(bits.subarray(0, 4)).toEqual(Buffer.from([0x20, 0x10, 0x20, 0xff]));
		expect(bits.subarray(4, 8)).toEqual(Buffer.from([0x60, 0x30, 0x60, 0xff]));
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them of the places of the picture of the walk of them", () => {
		// The places of the picture of the walk of the places of the picture of the picture of the walk of
		// them stand of the places of the picture of the walk of the places of the picture of the places of
		// the picture of the walk of them of the places of the picture of the walk of the places of the
		// picture of their own.
		const stream = Buffer.from([0x02, 0x10, 0x20, 0x30, 0x00, 0x00]);
		const plane = { lzss: stream };
		const file = picture(
			{ colors: 3, width: 3, height: 1 },
			block([plane, plane, plane]),
		);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg5(file, layout);
		// The places of the picture of the walk of the places of the picture of the picture stand of the
		// places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them where the places of the picture of the walk of the places of the picture of the
		// picture behind them stand not.
		expect(bits.subarray(0, 4)).toEqual(Buffer.from([0x20, 0x10, 0x20, 0xff]));
	});

	it("reads the places of the picture of the walk of the places of the picture of the picture of the places of the picture of the walk of them", () => {
		const file = picture(
			{ colors: 4, width: 1, height: 1 },
			block([
				{ raw: Buffer.from([0x02]) },
				{ raw: Buffer.from([0x02]) },
				{ raw: Buffer.from([0x02]) },
				{ raw: Buffer.from([0x03]) },
			]),
		);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg5(file, layout);
		// The places of the picture of the walk of the places of the picture of the picture of the walk of them
		// stand of the places of the picture of the walk of the places of the picture of the place of the
		// picture of the walk of them and of the places of the picture of the walk of the places of the
		// picture of the place of the picture of the walk of them.
		expect(bits.subarray(0, 4)).toEqual(Buffer.from([4, 2, 4, 3]));
	});

	it("turns away the places of the picture of the walk of the places of the picture of the sixth kind of the places of the picture", () => {
		// The places of the picture of the walk of the places of the picture of the sixth kind of the places
		// of the picture stand beside the places of the picture of the walk of the places of the picture of
		// the sound of the engine.
		const file = Buffer.concat([head6(4, 3, 2), Buffer.alloc(64, 0x00)]);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackTlg5(file, layout)).toThrow(GarbroError);
		const short = picture({ colors: 3, width: 2, height: 1 }, Buffer.alloc(2));
		const shortLayout = readTlgLayout(short, short.length);
		if (!shortLayout) throw new Error("no layout");
		expect(() => unpackTlg5(short, shortLayout)).toThrow(GarbroError);
	});

	it("stands the places of the picture of the walk of the places of the picture out as the places of the picture of the walk of them", async () => {
		const file = picture(
			{ colors: 3, width: 2, height: 1 },
			block([
				{ raw: Buffer.from([0x10, 0x20]) },
				{ raw: Buffer.from([0x20, 0x30]) },
				{ raw: Buffer.from([0x30, 0x40]) },
			]),
		);
		const handle = await kirikiriTlgImageFormat.open(
			new BufferByteSource(file),
			"cg/pic.tlg",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("pic.bmp");
		const bmp = await consumeBuffer(await handle.openEntry(entry.id));
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		expect(bmp.readInt32LE(0x16)).toBe(-1);
		expect(bmp.readUInt16LE(0x1c)).toBe(32);
	});

	it("is told by the words of the picture of the walk of the places of the picture", async () => {
		expect(kirikiriTlgImageFormat.descriptor.id).toBe("kirikiri-tlg-image");
		const file = picture(
			{ colors: 3, width: 2, height: 1 },
			block([
				{ raw: Buffer.from([0x10, 0x20]) },
				{ raw: Buffer.from([0x20, 0x30]) },
				{ raw: Buffer.from([0x30, 0x40]) },
			]),
		);
		await expect(
			kirikiriTlgImageFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("TLG7.0", 0, "latin1");
		await expect(
			kirikiriTlgImageFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
	});
});
