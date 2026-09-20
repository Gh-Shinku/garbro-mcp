import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeK4,
	decodeK4Picture,
	gsxK4ImageFormat,
	type K4Layout,
	readK4Layout,
} from "../../packages/formats/src/gsx/k4-image.js";
import { expectArchive } from "../helpers/archive.js";

const CONTROL_BASE = 0x58;
const CONTROL_LENGTH_FIELD = 0x54;
const BMP_PIXELS = 0x36;
const BMP_HEIGHT_FIELD = 0x16;
const BMP_BPP_FIELD = 0x1c;

function ones(count: number): number[] {
	return new Array<number>(count).fill(1);
}

/** Bits packed most significant first, the order both streams of the picture are read in. */
function msbBits(bits: readonly number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (!bit) continue;
		const at = index >> 3;
		out[at] = (out[at] ?? 0) | (0x80 >> (index & 7));
	}
	return out;
}

/** A stream of values of a given width each, packed most significant bit first. */
function msbValues(values: readonly (readonly [number, number])[]): Buffer {
	const bits: number[] = [];
	for (const [value, width] of values) {
		for (let index = width - 1; index >= 0; index -= 1) {
			bits.push((value >> index) & 1);
		}
	}
	return msbBits(bits);
}

function bytes(values: readonly number[]): Buffer {
	return msbValues(values.map((value) => [value, 8] as const));
}

interface K4Fixture {
	width: number;
	height: number;
	bitsPerPixel?: number;
	alphaMode?: number;
	frameCount?: number;
	delta?: boolean;
	/** The control plane, one bit to a step. */
	control: readonly number[];
	stream: Buffer;
	/** The alpha rows, in the order the picture stores its rows: the bottom one first. */
	alphaRows?: readonly Buffer[];
}

function k4File(options: K4Fixture): Buffer {
	const bitsPerPixel = options.bitsPerPixel ?? 24;
	const control = msbBits(options.control);
	const body: Buffer[] = [control, options.stream];
	let alphaPosition = 0;
	if (options.alphaRows) {
		alphaPosition = CONTROL_BASE + control.length + options.stream.length;
		if (0xff === (options.alphaMode ?? 0)) {
			// The first section of the alpha kind is a place to a row, counted from its own start.
			const table = Buffer.alloc(options.alphaRows.length * 4);
			let at = table.length;
			for (const [index, row] of options.alphaRows.entries()) {
				table.writeInt32LE(at, index * 4);
				at += row.length;
			}
			body.push(table, ...options.alphaRows);
		} else {
			body.push(...options.alphaRows);
		}
	}
	const header = Buffer.alloc(CONTROL_BASE);
	header.write("K4", 0, "latin1");
	header[2] = 1;
	header[3] = 2;
	header.writeUInt16LE(options.width, 4);
	header.writeUInt16LE(options.height, 6);
	header[0x0b] = options.alphaMode ?? 0;
	header.writeInt16LE(options.frameCount ?? 1, 0x0c);
	header[0x0f] = bitsPerPixel;
	// The second header, which is the one the reader unpacks with.
	header.writeUInt16LE(options.width, 0x30);
	header.writeUInt16LE(options.height, 0x32);
	header.writeUInt16LE(bitsPerPixel, 0x3c);
	header.writeUInt16LE(options.delta ? 1 : 0, 0x3e);
	header.writeUInt32LE(alphaPosition, 0x44);
	header.writeInt32LE(0x10 + control.length, CONTROL_LENGTH_FIELD);
	return Buffer.concat([header, ...body]);
}

function layoutOf(file: Buffer): K4Layout {
	const layout = readK4Layout(file);
	if (!layout) throw new Error("the fixture does not read as a GSX picture");
	return layout;
}

/** The pixels of a bitmap the port produced, with the row padding of a twenty four bit one taken out. */
function bmpPixels(bmp: Buffer, pixelSize: number, height: number): Buffer {
	const width = bmp.readInt32LE(0x12);
	const stride =
		pixelSize === 3 ? (width * pixelSize + 3) & ~3 : width * pixelSize;
	const out: number[] = [];
	for (let row = 0; row < height; row += 1) {
		const at = BMP_PIXELS + row * stride;
		out.push(...bmp.subarray(at, at + width * pixelSize));
	}
	return Buffer.from(out);
}

async function bitmapOf(file: Buffer): Promise<Buffer> {
	const archive = await gsxK4ImageFormat.open(
		new BufferByteSource(file),
		"picture.k4",
	);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("the picture has no entry");
		const chunks: Buffer[] = [];
		for await (const chunk of await archive.openEntry(entry.id)) {
			chunks.push(Buffer.from(chunk as Uint8Array));
		}
		return Buffer.concat(chunks);
	} finally {
		await archive.close();
	}
}

describe("GSX K4 image", () => {
	it("reads a pixel as a stored byte when the picture holds no differences", () => {
		// Two pixels a row at three bytes each leave eight bytes of row, so sixteen steps fill the picture.
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0];
		const file = k4File({
			width: 2,
			height: 2,
			control: ones(16),
			stream: bytes(values),
		});
		const layout = layoutOf(file);
		expect(layout.stride).toBe(8);
		expect(decodeK4(file, layout)).toEqual(Buffer.from(values));
	});

	it("adds a nine bit step to the byte three behind it when the picture holds differences", () => {
		// The first three bytes of a difference picture have no byte in front of them, so they are stored
		// whole; every byte behind them stands as a step of its own.
		const file = k4File({
			width: 2,
			height: 1,
			delta: true,
			control: ones(8),
			stream: msbValues([
				[0x10, 9],
				[0x20, 9],
				[0x30, 9],
				[0x00, 9],
				[0x00, 9],
				[0x00, 9],
				[0x00, 9],
				[0x00, 9],
			]),
		});
		expect(decodeK4(file, layoutOf(file))).toEqual(
			Buffer.from([0x10, 0x20, 0x30, 0x11, 0x21, 0x31, 0x12, 0x22]),
		);
	});

	it("lets a step wrap around the end of a byte", () => {
		const file = k4File({
			width: 1,
			height: 1,
			delta: true,
			control: ones(4),
			stream: msbValues([
				[0xfe, 9],
				[0x00, 9],
				[0x00, 9],
				[0x05, 9],
			]),
		});
		// 254 plus a step of five and the one both sides of a step count lands on four.
		expect(decodeK4(file, layoutOf(file))).toEqual(
			Buffer.from([0xfe, 0x00, 0x00, 0x04]),
		);
	});

	it("copies a run out of the picture, both in the narrow form and the wide one", () => {
		const file = k4File({
			width: 3,
			height: 1,
			control: [1, 1, 1, 0, 0, 1, 0, 1, 1, 1, 1],
			stream: Buffer.concat([
				bytes([0x11, 0x22, 0x33]),
				// A place of nine bits and a length of three, two longer than the count.
				msbValues([
					[2, 9],
					[0, 3],
					[0x99, 8],
					// A place of fourteen bits and a length of four, three longer than the count.
					[5, 14],
					[0, 4],
					[0xa1, 8],
					[0xa2, 8],
					[0xa3, 8],
				]),
			]),
		});
		expect(decodeK4(file, layoutOf(file))).toEqual(
			Buffer.from([
				0x11, 0x22, 0x33, 0x11, 0x22, 0x99, 0x11, 0x22, 0x33, 0xa1, 0xa2, 0xa3,
			]),
		);
	});

	it("copies a run that reaches into the bytes it is writing", () => {
		const file = k4File({
			width: 4,
			height: 1,
			control: [1, 1, 1, 0, 0],
			stream: Buffer.concat([
				bytes([0x11, 0x22, 0x55]),
				msbValues([
					[1, 9],
					[7, 3],
				]),
			]),
		});
		// A place of one points two bytes back, so the run takes the two byte pattern before it and then
		// keeps taking it out of what it has just written.
		expect(decodeK4(file, layoutOf(file))).toEqual(
			Buffer.from([
				0x11, 0x22, 0x55, 0x22, 0x55, 0x22, 0x55, 0x22, 0x55, 0x22, 0x55, 0x22,
			]),
		);
	});

	it("rebuilds a difference run out of the byte above and to the right of the one it names", () => {
		const file = k4File({
			width: 2,
			height: 1,
			delta: true,
			control: [1, 1, 1, 1, 1, 0, 1],
			stream: msbValues([
				[10, 9],
				[20, 9],
				[30, 9],
				[0, 9],
				[0, 9],
				[1, 14],
				[0, 4],
			]),
		});
		// Every byte of the run is the one it names, plus the one a step to the right of it and a row up,
		// less the one a row above the byte itself. A row up of the second row of bytes is a byte behind.
		const pixels = decodeK4(file, layoutOf(file));
		expect(pixels).toEqual(Buffer.from([10, 20, 30, 11, 21, 31, 12, 22]));
	});

	it("joins an alpha channel stored as runs of its own to the pixels", async () => {
		const values = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
		const file = k4File({
			width: 2,
			height: 2,
			alphaMode: 0xff,
			control: ones(16),
			stream: bytes(values),
			// The rows are stored from the bottom up, as the pixels are.
			alphaRows: [
				Buffer.from([0x80, 0x02]),
				Buffer.from([0x40, 0x01, 0x00, 0x01]),
			],
		});
		const layout = layoutOf(file);
		expect(layout.alphaPosition).toBe(0x58 + 2 + 16);
		const { pixels, bottomUp } = decodeK4Picture(file, layout);
		// The decoded rows turn over as they are joined, so the top row of the picture is the last stored one.
		expect(bottomUp).toBe(false);
		expect(pixels).toEqual(
			Buffer.from([
				0x08, 0x09, 0x0a, 0xff, 0x0b, 0x0c, 0x0d, 0xff, 0x00, 0x01, 0x02, 0x7f,
				0x03, 0x04, 0x05, 0x00,
			]),
		);
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(32);
		// The alpha channel is joined from the top down, so the bitmap keeps a negative height.
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(-2);
		expect(bmpPixels(bmp, 4, 2)).toEqual(pixels);
	});

	it("joins an alpha channel stored as one bit to a pixel", () => {
		const width = 10;
		const stride = (width * 3 + 3) & ~3;
		const values = new Array<number>(stride).fill(0);
		const file = k4File({
			width,
			height: 1,
			alphaMode: 0xfe,
			control: ones(stride),
			stream: bytes(values),
			// Ten pixels need two bytes of bits, the lowest bit of each standing for the first pixel.
			alphaRows: [Buffer.from([0x03, 0x01])],
		});
		const layout = layoutOf(file);
		expect(stride).toBe(32);
		expect(layout.alphaPosition).toBe(0x58 + 4 + 32);
		const { pixels, bottomUp } = decodeK4Picture(file, layout);
		expect(bottomUp).toBe(false);
		const alphas: number[] = [];
		for (let index = 3; index < width * 4; index += 4) {
			alphas.push(pixels[index] ?? 0);
		}
		expect(alphas).toEqual([255, 255, 0, 0, 0, 0, 0, 0, 255, 0]);
	});

	it("hands a picture with no alpha channel over as a bottom up bitmap", async () => {
		const values = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 0, 0, 0, 0];
		const file = k4File({
			width: 2,
			height: 2,
			control: ones(16),
			stream: bytes(values),
		});
		const bmp = await bitmapOf(file);
		expect(bmp.readUInt16LE(BMP_BPP_FIELD)).toBe(24);
		// The rows of the picture are stored from the bottom up, so the bitmap says so with a positive height.
		expect(bmp.readInt32LE(BMP_HEIGHT_FIELD)).toBe(2);
		// The bitmap takes its rows packed, so the bytes the stride left at the end are not written.
		expect(bmpPixels(bmp, 3, 2)).toEqual(Buffer.from(values.slice(0, 12)));
	});

	it("lists the picture as one bitmap and reports what it holds", async () => {
		const file = k4File({
			width: 1,
			height: 1,
			control: ones(4),
			stream: bytes([1, 2, 3, 4]),
			frameCount: 3,
		});
		await expectArchive({
			format: gsxK4ImageFormat,
			archive: file,
			sourcePath: "face.k4",
			entries: [{ path: "face.bmp", size: file.length }],
			metadata: {
				image: "bmp",
				width: 1,
				height: 1,
				bitsPerPixel: 24,
				frameCount: 3,
				alpha: false,
			},
		});
	});

	it("turns away a file whose header is not the one it expects", async () => {
		const good = k4File({
			width: 1,
			height: 1,
			control: ones(4),
			stream: bytes([1, 2, 3, 4]),
		});
		const withField = (
			offset: number,
			value: number,
			width: 2 | 4,
			signed = false,
		): Buffer => {
			const copy = Buffer.from(good);
			if (width === 2) {
				if (signed) copy.writeInt16LE(value, offset);
				else copy.writeUInt16LE(value, offset);
			} else if (signed) copy.writeInt32LE(value, offset);
			else copy.writeUInt32LE(value, offset);
			return copy;
		};
		const wrongVersion = Buffer.from(good);
		wrongVersion[2] = 3;
		expect(
			await gsxK4ImageFormat.detect(new BufferByteSource(good), "a.k4"),
		).toBe(true);
		for (const candidate of [
			good.subarray(0, CONTROL_BASE - 1),
			wrongVersion,
			withField(0x0c, 0, 2, true),
			withField(0x0c, -1, 2, true),
			withField(4, 0, 2),
			withField(6, 0, 2),
			withField(0x30, 0, 2),
			withField(0x32, 0, 2),
			withField(0x3c, 16, 2),
			withField(CONTROL_LENGTH_FIELD, 0x0f, 4, true),
			withField(CONTROL_LENGTH_FIELD, 0x1000, 4, true),
			withField(0x44, good.length + 4, 4),
		]) {
			expect(
				await gsxK4ImageFormat.detect(new BufferByteSource(candidate), "a.k4"),
			).toBe(false);
		}
	});

	it("refuses an alpha mode it does not know and a run that leaves the picture", () => {
		const unknownAlpha = k4File({
			width: 1,
			height: 1,
			alphaMode: 0x01,
			control: ones(4),
			stream: bytes([1, 2, 3, 4]),
			alphaRows: [Buffer.from([0x40, 0x01])],
		});
		const layout = layoutOf(unknownAlpha);
		expect(() => decodeK4Picture(unknownAlpha, layout)).toThrow(GarbroError);
		expect(() => decodeK4Picture(unknownAlpha, layout)).toThrow(/alpha/i);
		// A run that names a place reaching before the start of the picture.
		const beyond = k4File({
			width: 1,
			height: 1,
			control: [1, 1, 1, 0, 0],
			stream: Buffer.concat([
				bytes([1, 2, 3]),
				msbValues([
					[6, 9],
					[0, 3],
				]),
			]),
		});
		expect(() => decodeK4(beyond, layoutOf(beyond))).toThrow(GarbroError);
		// The same, with the picture holding differences, where a run is rebuilt rather than copied.
		const beyondDelta = k4File({
			width: 2,
			height: 1,
			delta: true,
			control: [1, 1, 1, 0, 1],
			stream: msbValues([
				[1, 9],
				[2, 9],
				[3, 9],
				[0, 14],
				[0, 4],
			]),
		});
		expect(() => decodeK4(beyondDelta, layoutOf(beyondDelta))).toThrow(
			GarbroError,
		);
	});
});
