import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readMagLayout,
	unpackMag,
	bananaMagImageFormat,
} from "../../packages/formats/src/banana/mag-image.js";

/** Packs a stream of literals, which is all the reference's own reader has to unfold. */
function lzssLiterals(data: Buffer): Buffer {
	const chunks: Buffer[] = [];
	for (let start = 0; start < data.length; start += 8) {
		const group = data.subarray(start, start + 8);
		chunks.push(Buffer.from([(0xff >>> (8 - group.length)) & 0xff]), group);
	}
	return Buffer.concat(chunks);
}

/** The inverse of the reference's own two walks, so a stream unfolds to the pixels a test wants. */
function deltaEncode(pixels: Buffer, stride: number): Buffer {
	const store = Buffer.alloc(pixels.length);
	for (let i = 0; i < stride && i < pixels.length; i += 1) {
		store[i] = pixels[i] ?? 0;
	}
	for (let i = 3; i < stride; i += 1) {
		store[i] = ((pixels[i] ?? 0) - (pixels[i - 3] ?? 0)) & 0xff;
	}
	for (let i = stride; i < pixels.length; i += 1) {
		store[i] = ((pixels[i] ?? 0) - (pixels[i - stride] ?? 0)) & 0xff;
	}
	return store;
}

interface MagOptions {
	left?: number;
	top?: number;
	right?: number;
	bottom?: number;
	canvasWidth?: number;
	canvasHeight?: number;
	reserved?: number;
}

/** A file: the head, the pixels and, when given, the alpha stream behind them. */
function magFile(
	pixels: Buffer,
	stride: number,
	alpha: Buffer | undefined,
	options: MagOptions = {},
): Buffer {
	const left = options.left ?? 0;
	const top = options.top ?? 0;
	const height = Math.round(pixels.length / stride);
	const right = options.right ?? left + stride / 3;
	const bottom = options.bottom ?? top + height;
	const canvasWidth = options.canvasWidth ?? 4;
	const canvasHeight = options.canvasHeight ?? 4;
	const head = Buffer.alloc(0x24);
	head.writeInt32LE(left, 0);
	head.writeInt32LE(top, 4);
	head.writeInt32LE(right, 8);
	head.writeInt32LE(bottom, 0xc);
	head.writeInt32LE(options.reserved ?? 0, 0x10);
	head.writeInt32LE(0, 0x14);
	head.writeInt32LE(canvasWidth, 0x18);
	head.writeInt32LE(canvasHeight, 0x1c);
	const pixelStream = lzssLiterals(deltaEncode(pixels, stride));
	if (!alpha) {
		head.writeUInt32LE(0, 0x20);
		return Buffer.concat([head, pixelStream]);
	}
	head.writeUInt32LE(pixelStream.length, 0x20);
	return Buffer.concat([head, pixelStream, lzssLiterals(alpha)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await bananaMagImageFormat.open(
		new BufferByteSource(data),
		"pic.mag",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

const PIXELS = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);

describe("BANANA Shu-Shu picture", () => {
	it("reads the head as the reference does", () => {
		const layout = readMagLayout(
			magFile(PIXELS, 6, undefined, { left: 1, top: 1 }),
		);
		expect(layout).toEqual({
			width: 2,
			height: 2,
			left: 1,
			top: 1,
			canvasWidth: 4,
			canvasHeight: 4,
			alphaOffset: 0,
		});
	});

	it("declines a head that does not describe a picture", () => {
		const base = magFile(PIXELS, 6, undefined);
		expect(readMagLayout(base)).toBeDefined();
		// The two words at 0x10 and 0x14 must be nothing.
		const reserved = Buffer.from(base);
		reserved.writeInt32LE(1, 0x10);
		expect(readMagLayout(reserved)).toBeUndefined();
		// The rectangle has to lie inside the canvas.
		const outside = magFile(PIXELS, 6, undefined, {
			left: 4,
			right: 6,
			canvasWidth: 4,
		});
		expect(readMagLayout(outside)).toBeUndefined();
		// The canvas may not be larger than 0x2000 in either direction.
		const huge = magFile(PIXELS, 6, undefined, {
			canvasWidth: 0x2001,
		});
		expect(readMagLayout(huge)).toBeUndefined();
		// A picture of no size.
		const empty = magFile(PIXELS, 6, undefined, { right: 0, bottom: 0 });
		expect(readMagLayout(empty)).toBeUndefined();
	});

	it("reports the measurements and the placement", async () => {
		const handle = await bananaMagImageFormat.open(
			new BufferByteSource(magFile(PIXELS, 6, undefined, { left: 1, top: 1 })),
			"dir/pic.mag",
		);
		expect(handle.entries[0]?.path).toBe("pic.bmp");
		expect(handle.entries[0]?.metadata).toMatchObject({
			width: 2,
			height: 2,
			bitsPerPixel: 24,
			offsetX: 1,
			offsetY: 1,
			canvasWidth: 4,
			canvasHeight: 4,
		});
		expect(handle.metadata).toMatchObject({
			image: "bmp",
			compression: "lzss",
			hasAlpha: false,
		});
	});

	it("unfolds a delta walked picture into a bitmap of bottom up rows", async () => {
		const out = await extract(magFile(PIXELS, 6, undefined));
		expect(out.readUInt16LE(0x1c)).toBe(24);
		expect(out.readInt32LE(0x12)).toBe(2);
		// `CreateFlipped` means bottom up rows under a positive height.
		expect(out.readInt32LE(0x16)).toBe(2);
		// Two rows of two pixels, each row padded to eight bytes, in the stored order.
		expect(out.subarray(54).toString("hex")).toBe(
			"01020304050600000708090a0b0c0000",
		);
	});

	it("reads the alpha of the picture from the canvas it lies on", async () => {
		// The canvas is four by four, so the alpha stream holds sixteen bytes and the picture lies at one
		// across and one down.
		const alpha = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const out = await extract(magFile(PIXELS, 6, alpha, { left: 1, top: 1 }));
		expect(out.readUInt16LE(0x1c)).toBe(32);
		// `ImageData.Create` keeps the stored order top down.
		expect(out.readInt32LE(0x16)).toBe(-2);
		// The bottom row of the picture is read first, then the top row, each with the alpha of the place it
		// stands at on the canvas: row one of the canvas is bytes nine and ten, row naught bytes five and six.
		expect(out.subarray(54).toString("hex")).toBe(
			"070809" + "0a" + "0a0b0c" + "0b" + "010203" + "06" + "040506" + "07",
		);
	});

	it("declines a stream that unfolds short of the picture", async () => {
		const data = magFile(PIXELS, 6, undefined).subarray(0, 0x28);
		const handle = await bananaMagImageFormat.open(
			new BufferByteSource(data),
			"pic.mag",
		);
		await expect(handle.openEntry("0")).rejects.toThrow(GarbroError);
		await expect(handle.openEntry("0")).rejects.toThrow("cut short");
	});

	it("unfolds a stream of nothing but the reference's own walk", () => {
		const layout = {
			width: 2,
			height: 2,
			left: 0,
			top: 0,
			canvasWidth: 4,
			canvasHeight: 4,
			alphaOffset: 0,
		};
		// Every byte behind the first three is the sum of itself and the byte three before it, and then of
		// the byte a row before it, so a stream of nothing but ones walks the first row up to two and then
		// carries it into the second.
		const head = Buffer.alloc(0x24);
		const store = Buffer.alloc(12, 0x01);
		const out = unpackMag(Buffer.concat([head, lzssLiterals(store)]), layout);
		expect(out.subarray(0, 6).toString("hex")).toBe("010101020202");
	});
});
