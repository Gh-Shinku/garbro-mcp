import { Buffer } from "node:buffer";
import {
	BufferByteSource,
	FileByteSource,
	GarbroError,
} from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { writeFile } from "node:fs/promises";
import { describe, expect, it } from "vitest";
import { withCompanionFiles } from "../helpers/companion.js";
import {
	kirikiriTlgImageFormat,
	readTlgLayout,
	unpackTlg5,
} from "../../packages/formats/src/kirikiri/tlg-image.js";
import {
	blendTlgImage,
	readTlgTags,
} from "../../packages/formats/src/kirikiri/tlg-tags.js";
import { unpackTlg6 } from "../../packages/formats/src/kirikiri/tlg6.js";

const HEAD_SIZE = 0x26;
const DATA_OFFSET_5 = 20;
const DATA_OFFSET_6 = 23;
const MAX_BIT_LENGTH_6 = 8;
const GOLOMB_METHOD = 0;
const AVERAGE_METHOD = 1;

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the sound of the places of
 * the picture of the walk of the places of the picture of the words of the walk of the picture of the places of
 * the picture of the walk of them. */
function tagField(keyLength: number, key: number, value: Buffer): Buffer {
	const keyBytes = Buffer.alloc(keyLength, 0x00);
	if (keyLength === 1) keyBytes[0] = key;
	else if (keyLength === 2) keyBytes.writeUInt16LE(key, 0);
	else keyBytes.writeInt32LE(key, 0);
	return Buffer.concat([
		Buffer.from(`${keyLength}:`, "latin1"),
		keyBytes,
		Buffer.alloc(1, 0x00),
		Buffer.from(`${value.length}:`, "latin1"),
		value,
		Buffer.alloc(1, 0x00),
	]);
}

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the words of the walk of
 * them of the places of the picture of the walk of the places of the picture. */
function tagTail(fields: Buffer[]): Buffer {
	const body = Buffer.concat(fields);
	return Buffer.concat([
		Buffer.from("tags", "latin1"),
		word(body.length),
		body,
	]);
}

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the kind of the places of
 * the picture of the walk of them of the places of the picture of the walk of the places of the picture. */
function overlayTags(
	baseName: string,
	offsetX: number,
	offsetY: number,
): Buffer {
	return tagTail([
		tagField(1, 1, Buffer.from(baseName, "latin1")),
		tagField(1, 2, Buffer.from([offsetX])),
		tagField(
			2,
			3,
			(() => {
				const out = Buffer.alloc(2, 0x00);
				out.writeUInt16LE(offsetY, 0);
				return out;
			})(),
		),
	]);
}

/** The places of the picture of the walk of the places of the picture of the words of the walk of the picture
 * of the places of the picture of the walk of them of the places of the picture of the walk of the places of
 * the picture of the sound of the places of the picture of the walk of the places of the picture. */
function word(value: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeInt32LE(value, 0);
	return out;
}

/** The places of the picture of the walk of the places of the picture of the kind of the places of the picture
 * of the walk of the places of the picture of the places of the picture of the walk of them of the places of
 * the picture of the walk of the places of the picture, standing of the places of the picture of the walk of
 * the places of the picture of the sound of the places of the picture of the walk of the places of the picture
 * of their own beside them. */
function filterStream(count: number): Buffer {
	return Buffer.concat([word(count + 1), Buffer.alloc(count + 1, 0x00)]);
}

/** The places of the picture of the walk of the places of the picture of the places of the picture of the
 * walk of them of the places of the picture of the walk of the places of the picture of the sound of the
 * places of the picture of the walk of the places of the picture of the sixth kind of the places of the
 * picture of the walk of the places of the picture. */
function tlg6(
	options: { colors: number; width: number; height: number },
	filters: Buffer,
	planes: { method?: number; bits: number; payload: Buffer }[],
): Buffer {
	const parts = [
		head6(options.colors, options.width, options.height),
		word(MAX_BIT_LENGTH_6),
		filters,
	];
	for (const plane of planes) {
		const method = plane.method ?? GOLOMB_METHOD;
		parts.push(word((method << 30) | plane.bits), plane.payload);
	}
	return Buffer.concat(parts);
}

/** The places of the picture of the walk of the places of the picture of the place of the picture of the walk
 * of them of the places of the picture of the walk of the places of the picture of the sound of the places of
 * the picture of the walk of the places of the picture of no places of the picture of the walk of the places of
 * the picture of their own. */
function zeroRun(count: number): Buffer {
	const bits: number[] = [];
	const put = (value: number, width: number): void => {
		for (let i = 0; i < width; i += 1) bits.push((value >>> i) & 1);
	};
	// The places of the picture of the walk of the places of the picture of the sound of the places of the
	// picture of the walk of the places of the picture stand of the places of the picture of the walk of the
	// places of the picture of the kind of the places of the picture of the walk of the places of the picture
	// of the place of the picture of the walk of them: the places of the picture of the walk of the places of
	// the picture of the place of the picture of the walk of them of the places of the picture of the walk of
	// the places of the picture of the sound, and of the places of the picture of the walk of the places of
	// the picture of the place of the picture of the walk of them of the places of the picture of the walk of
	// them of the places of the picture of their own.
	put(0, 1);
	let first = 0;
	while (1 << (first + 1) <= count) first += 1;
	put(1 << first, first + 1);
	put(count - (1 << first), first);
	const out = Buffer.alloc(Math.ceil(bits.length / 8), 0x00);
	for (let i = 0; i < bits.length; i += 1)
		if (bits[i]) out[i >> 3] = (out[i >> 3] ?? 0) | (1 << (i & 7));
	return out;
}

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

	it("reads the places of the picture of the walk of the places of the picture of the sixth kind of the places of the picture of the walk of the places of the picture of the sound of the places of the picture", () => {
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them of the places of the picture of the walk of the places of the picture of the sound stand
		// of the places of the picture of the walk of the places of the picture of the place of the picture of
		// the walk of them of the places of the picture of the walk of the places of the picture of the kind of
		// the places of the picture of the walk of the places of the picture.
		const file = tlg6({ colors: 3, width: 1, height: 1 }, filterStream(1), [
			{ bits: 3, payload: Buffer.from([0x07]) },
			{ bits: 3, payload: Buffer.from([0x07]) },
			{ bits: 3, payload: Buffer.from([0x07]) },
		]);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg6(file, layout);
		expect(Array.from(bits.subarray(0, 4))).toEqual([0xff, 0xff, 0xff, 0xff]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of no places of their own of the places of the picture of the walk of the places of the picture", () => {
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them of the places of the picture of the walk of the places of the picture of the sound stand
		// of the places of the picture of the walk of the places of the picture of the place of the picture of
		// the walk of them of the places of the picture of the walk of the places of the picture of the kind of
		// the places of the picture of the walk of the places of the picture.
		const three = tlg6({ colors: 3, width: 1, height: 1 }, filterStream(1), [
			{ bits: 2, payload: Buffer.from([0x02]) },
			{ bits: 2, payload: Buffer.from([0x02]) },
			{ bits: 2, payload: Buffer.from([0x02]) },
		]);
		const threeLayout = readTlgLayout(three, three.length);
		if (!threeLayout) throw new Error("no layout");
		expect(Array.from(unpackTlg6(three, threeLayout).subarray(0, 4))).toEqual([
			0x00, 0x00, 0x00, 0xff,
		]);
		const four = tlg6({ colors: 4, width: 1, height: 1 }, filterStream(1), [
			{ bits: 2, payload: Buffer.from([0x02]) },
			{ bits: 2, payload: Buffer.from([0x02]) },
			{ bits: 2, payload: Buffer.from([0x02]) },
			{ bits: 2, payload: Buffer.from([0x02]) },
		]);
		const fourLayout = readTlgLayout(four, four.length);
		if (!fourLayout) throw new Error("no layout");
		expect(Array.from(unpackTlg6(four, fourLayout).subarray(0, 4))).toEqual([
			0x00, 0x00, 0x00, 0x00,
		]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sixth kind out of the places of the picture of the walk of the places of the picture of the words of the walk of the picture", () => {
		// The places of the picture of the walk of the places of the picture of the walk of them of the places
		// of the picture of the walk of the places of the picture stand of the places of the picture of the
		// walk of the places of the picture of the places of the picture of the walk of them of the places of
		// the picture of the walk of the places of the picture, and of the places of the picture of the walk of
		// the places of the picture of the kind of the places of the picture of the walk of the places of the
		// picture of the sound of the places of the picture of the walk of the places of the picture of their
		// own.
		const run = zeroRun(9);
		const file = tlg6({ colors: 3, width: 9, height: 1 }, filterStream(2), [
			{ bits: 8, payload: run },
			{ bits: 8, payload: run },
			{ bits: 8, payload: run },
		]);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg6(file, layout);
		expect(bits.length).toBe(9 * 4);
		for (let i = 0; i < 9; i += 1)
			expect(Array.from(bits.subarray(i * 4, i * 4 + 4))).toEqual([
				0x00, 0x00, 0x00, 0xff,
			]);
	});

	it("stands the places of the picture of the walk of the places of the picture of the place of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of their own", () => {
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them of the places of the picture of the walk of the places of the picture stand of the
		// places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of the places of the picture of the sound of the places of the picture of the
		// walk of the places of the picture of their own.
		const file = tlg6({ colors: 3, width: 2, height: 1 }, filterStream(1), [
			{ bits: 7, payload: Buffer.from([0x55]) },
			{ bits: 7, payload: Buffer.from([0x55]) },
			{ bits: 7, payload: Buffer.from([0x55]) },
		]);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const bits = unpackTlg6(file, layout);
		expect(Array.from(bits.subarray(0, 8))).toEqual([
			0xff, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff,
		]);
	});

	it("turns away the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the sixth kind that stand of no places of the picture of the walk of the places of the picture", () => {
		const file = tlg6({ colors: 3, width: 1, height: 1 }, filterStream(1), [
			{ method: AVERAGE_METHOD, bits: 2, payload: Buffer.from([0x02]) },
		]);
		const layout = readTlgLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackTlg6(file, layout)).toThrow(GarbroError);
		const short = tlg6({ colors: 3, width: 1, height: 1 }, filterStream(1), [
			{ bits: 2, payload: Buffer.from([0x02]) },
		]);
		const shortLayout = readTlgLayout(short, short.length);
		if (!shortLayout) throw new Error("no layout");
		expect(() => unpackTlg6(short, shortLayout)).toThrow(GarbroError);
	});

	it("reads the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them of the places of the picture of the walk of the places of the picture", () => {
		const tail = tagTail([
			tagField(1, 1, Buffer.from("base.tlg", "latin1")),
			tagField(1, 2, Buffer.from([0x10])),
			tagField(2, 3, Buffer.from([0x20, 0x00])),
			tagField(1, 4, Buffer.from([0x02])),
		]);
		const tags = readTlgTags(tail);
		if (!tags) throw new Error("no tags");
		expect(tags.baseName).toBe("base.tlg");
		expect(tags.offsetX).toBe(0x10);
		expect(tags.offsetY).toBe(0x20);
		expect(tags.method).toBe(2);
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them stand of the places of the picture of the walk of the places of the picture of the sound
		// of the places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them of the places of the picture of the walk of the places of the picture.
		expect(readTlgTags(Buffer.alloc(64, 0x00))).toBeUndefined();
		expect(readTlgTags(Buffer.from("tags", "latin1"))).toBeUndefined();
		// The reference stands the places of the picture of the walk of the places of the picture of the place
		// of the picture of the walk of them of the places of the picture of the walk of the places of the
		// picture of the sound where they stand of the places of the picture of the walk of the places of the
		// picture of the kind of the places of the picture of the walk of them of the places of the picture of
		// the walk of the places of the picture.
		const doubled = Buffer.concat([tail, Buffer.alloc(16, 0x00), tail]);
		expect(readTlgTags(doubled)?.baseName).toBe("base.tlg");
	});

	it("stands the places of the picture of the walk of the places of the picture of the overlay of the places of the picture of the walk of them of the places of the picture of the base of the places of the picture of the walk of them", () => {
		// The places of the picture of the walk of the places of the picture of the sound of the places of the
		// picture of the walk of the places of the picture of the kind of the places of the picture of the walk
		// of them of the places of the picture of the walk of the places of the picture of the places of the
		// picture of the walk of the places of the picture of the sound of the places of the picture.
		const base = Buffer.from([0x00, 0x00, 0x00, 0xff, 0x11, 0x22, 0x33, 0xff]);
		const opaque = Buffer.from([0x44, 0x55, 0x66, 0xff]);
		const blended = blendTlgImage(base, 2, 1, opaque, 1, 1, 1, 0, 1);
		expect(Array.from(blended ?? [])).toEqual([
			0x00, 0x00, 0x00, 0xff, 0x44, 0x55, 0x66, 0xff,
		]);
		// The places of the picture of the walk of the places of the picture of the place of the picture of the
		// walk of them of the places of the picture of the walk of the places of the picture of the sound of the
		// places of the picture of the walk of the places of the picture of the kind of the places of the
		// picture of the walk of them of the places of the picture of the walk of the places of the picture.
		const half = Buffer.from([0xff, 0xff, 0xff, 0x80]);
		const mixed = blendTlgImage(
			Buffer.from([0x00, 0x00, 0x00, 0xff]),
			1,
			1,
			half,
			1,
			1,
			0,
			0,
			1,
		);
		// floor((0xff * 0x80 + 0x00 * 0x7f) / 0xff) = 0x80, and the places of the picture of the walk of the
		// places of the picture of the sound of the places of the picture of the walk of the places of the
		// picture of the base of the places of the picture of the walk of them stand of the places of the
		// picture of the walk of the places of the picture of the sound of the places of the picture of the
		// walk of the places of the picture of the kind of the places of the picture of the walk of them.
		expect(Array.from(mixed ?? [])).toEqual([0x80, 0x80, 0x80, 0xff]);
		// The places of the picture of the walk of the places of the picture of the words of the walk of the
		// picture of the places of the picture of the walk of them of the places of the picture of the walk of
		// the places of the picture of the sound of the places of the picture of the walk of the places of the
		// picture of the kind of the places of the picture of the walk of them of the places of the picture of
		// their own of the places of the picture of the walk of the places of the picture.
		const clear = blendTlgImage(
			Buffer.from([0x01, 0x02, 0x03, 0xff]),
			1,
			1,
			Buffer.from([0xff, 0xff, 0xff, 0x00]),
			1,
			1,
			0,
			0,
			1,
		);
		expect(Array.from(clear ?? [])).toEqual([0x01, 0x02, 0x03, 0xff]);
		// The places of the picture of the walk of the places of the picture of the places of the picture of
		// the walk of the places of the picture stand of the places of the picture of the walk of the places of
		// the picture of the kind of the places of the picture of the walk of them of the places of the picture
		// of the walk of the places of the picture of the sound of the places of the picture of the walk of the
		// places of the picture of the kind of the places of the picture of the walk of the places of the
		// picture of their own.
		const exclusive = blendTlgImage(
			Buffer.from([0xff, 0x00, 0x0f, 0xff]),
			1,
			1,
			Buffer.from([0x0f, 0xff, 0xf0, 0x0f]),
			1,
			1,
			0,
			0,
			2,
		);
		expect(Array.from(exclusive ?? [])).toEqual([0xf0, 0xff, 0xff, 0xf0]);
		// The places of the picture of the walk of the places of the picture of the overlay of the places of the
		// picture of the walk of them that stand past the places of the picture of the walk of the places of the
		// picture of the base of the places of the picture of the walk of them stand of the places of the
		// picture of the walk of the places of the picture of no places of the picture of the walk of the places
		// of the picture.
		expect(
			blendTlgImage(
				Buffer.alloc(8, 0x00),
				2,
				1,
				Buffer.alloc(4, 0xff),
				1,
				1,
				2,
				0,
				1,
			),
		).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of the sixth kind which the places of the picture of the walk of the places of the picture of the base of the places of the picture of the walk of them stand beside", async () => {
		// The places of the picture of the walk of the places of the picture of the base of the places of the
		// picture of the walk of them stand of the places of the picture of the walk of the places of the
		// picture of no places of their own of the places of the picture of the walk of the places of the
		// picture, and the places of the picture of the walk of the places of the picture of the overlay stand
		// of the places of the picture of the walk of the places of the picture of the sound of the places of
		// the picture of the walk of the places of the picture of the kind of the places of the picture of the
		// walk of them.
		const black = tlg6({ colors: 3, width: 2, height: 1 }, filterStream(1), [
			{ bits: 4, payload: Buffer.from([0x04]) },
			{ bits: 4, payload: Buffer.from([0x04]) },
			{ bits: 4, payload: Buffer.from([0x04]) },
		]);
		const white = Buffer.concat([
			tlg6({ colors: 3, width: 1, height: 1 }, filterStream(1), [
				{ bits: 3, payload: Buffer.from([0x07]) },
				{ bits: 3, payload: Buffer.from([0x07]) },
				{ bits: 3, payload: Buffer.from([0x07]) },
			]),
			overlayTags("base.tlg", 1, 0),
		]);
		await withCompanionFiles(
			"overlay.tlg",
			{ "base.tlg": black },
			async (mainPath) => {
				await writeFile(mainPath, white);
				const source = await FileByteSource.open(mainPath);
				const archive = await kirikiriTlgImageFormat.open(source, mainPath);
				const entry = archive.entries[0];
				if (!entry) throw new Error("no entry");
				const bmp = await consumeBuffer(await archive.openEntry(entry.id));
				// The places of the picture of the walk of the places of the pictures of the base of the places
				// of the picture of the walk of them stand of the places of the picture of the walk of the
				// places of the picture of the picture, and of the places of the picture of the walk of the
				// places of the picture of the place of the picture of the walk of them of the places of the
				// picture of the walk of the places of the picture of the overlay stand of the places of the
				// picture of the walk of the places of the picture of the sound of the places of the picture of
				// the walk of the places of the picture of the kind of the places of the picture of the walk of
				// them of the places of the picture of the walk of the places of the picture.
				expect(bmp.readInt32LE(0x12)).toBe(2);
				expect(bmp.readInt32LE(0x16)).toBe(-1);
				expect(Array.from(bmp.subarray(0x36, 0x3e))).toEqual([
					0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0xff, 0xff,
				]);
			},
		);
	});

	it("stands the places of the picture of the walk of the places of the picture of the overlays of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the base of the places of the picture of the walk of them where the places of the picture of the walk of the places of the picture of the base stand of no places of the picture of the walk of the places of the picture", async () => {
		const white = Buffer.concat([
			tlg6({ colors: 3, width: 1, height: 1 }, filterStream(1), [
				{ bits: 3, payload: Buffer.from([0x07]) },
				{ bits: 3, payload: Buffer.from([0x07]) },
				{ bits: 3, payload: Buffer.from([0x07]) },
			]),
			overlayTags("missing.tlg", 0, 0),
		]);
		await withCompanionFiles("overlay.tlg", {}, async (mainPath) => {
			await writeFile(mainPath, white);
			const source = await FileByteSource.open(mainPath);
			const archive = await kirikiriTlgImageFormat.open(source, mainPath);
			const entry = archive.entries[0];
			if (!entry) throw new Error("no entry");
			const bmp = await consumeBuffer(await archive.openEntry(entry.id));
			expect(bmp.readInt32LE(0x12)).toBe(1);
			expect(Array.from(bmp.subarray(0x36, 0x3a))).toEqual([
				0xff, 0xff, 0xff, 0xff,
			]);
		});
	});
});
