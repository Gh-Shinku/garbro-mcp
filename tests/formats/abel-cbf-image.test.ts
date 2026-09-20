import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	abelCbfImageFormat,
	decodeCbf,
	mergeCbfAlpha,
	readCbfAlpha,
	readCbfLayout,
} from "../../packages/formats/src/abel/cbf-image.js";
import { withCompanionFiles } from "../helpers/companion.js";
import { literalLzssStream } from "../helpers/lzss.js";

function cbfFile(input: {
	compression: number;
	width: number;
	height: number;
	body: Buffer;
	flag?: number;
	word?: string;
	bitsPerPixel?: number;
}): Buffer {
	const head = Buffer.alloc(0x18, 0x00);
	head.write(input.word ?? `CBF${input.compression}`, 0, "latin1");
	head.writeUInt32LE(input.width, 4);
	head.writeUInt32LE(input.height, 8);
	head.writeInt32LE(input.bitsPerPixel ?? 24, 12);
	head.writeInt32LE(input.flag ?? 1, 0x10);
	return Buffer.concat([head, input.body]);
}

const ZIGZAG_ORDER = [
	0x00, 0x01, 0x08, 0x10, 0x09, 0x02, 0x03, 0x0a, 0x11, 0x18, 0x20, 0x19, 0x12,
	0x0b, 0x04, 0x05, 0x0c, 0x13, 0x1a, 0x21, 0x28, 0x30, 0x29, 0x22, 0x1b, 0x14,
	0x0d, 0x06, 0x07, 0x0e, 0x15, 0x1c, 0x23, 0x2a, 0x31, 0x38, 0x39, 0x32, 0x2b,
	0x24, 0x1d, 0x16, 0x0f, 0x17, 0x1e, 0x25, 0x2c, 0x33, 0x3a, 0x3b, 0x34, 0x2d,
	0x26, 0x1f, 0x27, 0x2e, 0x35, 0x3c, 0x3d, 0x36, 0x2f, 0x37, 0x3e, 0x3f,
];

/** The places of a picture of eight by eight: its red stands for the place along a row and its green along one
 * down a column. */
function pattern(): Buffer {
	const places: number[] = [];
	for (let y = 0; y < 8; y += 1) {
		for (let x = 0; x < 8; x += 1) {
			places.push(x * 3, y * 3, 0x40);
		}
	}
	return Buffer.from(places);
}

function zigzagWalk(pixels: Buffer): Buffer {
	const stride = 24;
	const walked: number[] = [];
	for (let place = 0; place < 64; place += 1) {
		const order = ZIGZAG_ORDER[place] ?? 0;
		const at = (order & 7) * 3 + (order >> 3) * stride;
		walked.push(pixels[at] ?? 0, pixels[at + 1] ?? 0, pixels[at + 2] ?? 0);
	}
	return Buffer.from(walked);
}

function addUp(walked: Buffer): Buffer {
	const stored = Buffer.from(walked);
	for (let at = stored.length - 1; at >= 3; at -= 1) {
		stored[at] = ((stored[at] ?? 0) - (walked[at - 3] ?? 0)) & 0xff;
	}
	return stored;
}

async function extract(
	data: Buffer,
	sourcePath = "picture.cbf",
): Promise<Buffer> {
	const handle = await abelCbfImageFormat.open(
		new BufferByteSource(data),
		sourcePath,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Abel image format", () => {
	it("reads the head of a picture", () => {
		const data = cbfFile({
			compression: 0,
			width: 2,
			height: 1,
			body: Buffer.alloc(6),
		});
		expect(readCbfLayout(data)).toEqual({
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			compression: 0,
			stride: 6,
		});
		for (const word of ["CBF1", "CBF2", "CBF3"]) {
			const other = Buffer.from(data);
			other.write(word, 0, "latin1");
			expect(readCbfLayout(other)?.compression).toBe(Number(word[3]));
		}
		const wrongWord = Buffer.from(data);
		wrongWord.write("CBF4", 0, "latin1");
		expect(readCbfLayout(wrongWord)).toBeUndefined();
		const wrongFlag = Buffer.from(data);
		wrongFlag.writeInt32LE(0, 0x10);
		expect(readCbfLayout(wrongFlag)).toBeUndefined();
		expect(readCbfLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
	});

	it("reads the places of a picture that stand as they are", () => {
		const places = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
		const data = cbfFile({ compression: 0, width: 4, height: 1, body: places });
		const layout = readCbfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeCbf(data, layout).toString("hex")).toBe(
			places.toString("hex"),
		);
	});

	it("reads the places of a picture that stand in runs", () => {
		// Every place of a colour takes three bytes and a byte behind it says how many places of that colour
		// stand there: one for nought, and the number itself otherwise.
		const body = Buffer.from([1, 2, 3, 3, 4, 5, 6, 0, 7, 8, 9, 4]);
		const data = cbfFile({ compression: 2, width: 8, height: 1, body });
		const layout = readCbfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeCbf(data, layout).toString("hex")).toBe(
			hex([
				1, 2, 3, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9,
			]),
		);
	});

	it("reads the places of a picture that stand in the zigzag of its blocks", () => {
		const pixels = pattern();
		const data = cbfFile({
			compression: 1,
			width: 8,
			height: 8,
			body: literalLzssStream(addUp(zigzagWalk(pixels))),
		});
		const layout = readCbfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeCbf(data, layout).toString("hex")).toBe(
			pixels.toString("hex"),
		);
	});

	it("reads the places of a picture that stand in runs behind a walk of the LZSS kind", () => {
		const body = Buffer.from([1, 2, 3, 3, 4, 5, 6, 0, 7, 8, 9, 4]);
		// The walk of the LZSS kind of the third way stands four bytes behind the head.
		const data = cbfFile({
			compression: 3,
			width: 8,
			height: 1,
			body: Buffer.concat([Buffer.alloc(4, 0x00), literalLzssStream(body)]),
		});
		const layout = readCbfLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeCbf(data, layout).toString("hex")).toBe(
			hex([
				1, 2, 3, 1, 2, 3, 1, 2, 3, 4, 5, 6, 7, 8, 9, 7, 8, 9, 7, 8, 9, 7, 8, 9,
			]),
		);
	});

	it("reads the shape of the places that stand beside a picture", () => {
		// The shape stands in a file beside the picture: the word `ALP1`, how many places it holds and then a
		// byte and a count at a time.
		const alpha = Buffer.alloc(0x10 + 6, 0x00);
		alpha.write("ALP1", 0, "latin1");
		alpha.writeInt32LE(4, 8);
		alpha[0x10] = 0x40;
		alpha[0x11] = 2;
		alpha[0x12] = 0x80;
		alpha[0x13] = 2;
		expect(readCbfAlpha(alpha)?.toString("hex")).toBe("40408080");
		expect(readCbfAlpha(Buffer.alloc(0x10, 0x00))).toBeUndefined();
		const layout = {
			width: 2,
			height: 1,
			bitsPerPixel: 24,
			compression: 0,
			stride: 6,
		};
		expect(
			mergeCbfAlpha(
				Buffer.from([1, 2, 3, 4, 5, 6]),
				layout,
				Buffer.from([0x40, 0x80]),
			).toString("hex"),
		).toBe(hex([1, 2, 3, 0x40, 4, 5, 6, 0x80]));
	});

	it("gathers a picture into a bitmap", async () => {
		const places = Buffer.from([1, 2, 3, 4, 5, 6]);
		const data = cbfFile({ compression: 0, width: 2, height: 1, body: places });
		const bmp = await extract(data);
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readUInt32LE(0x12)).toBe(2);
		expect(bmp.readInt32LE(0x16)).toBe(-1);
		expect(bmp.readUInt16LE(0x1c)).toBe(24);
		expect(bmp.readUInt32LE(0x22)).toBe(8);
		expect(bmp.subarray(0x36, 0x3e).toString("hex")).toBe(
			hex([1, 2, 3, 4, 5, 6, 0, 0]),
		);
	});

	it("takes the shape of the places from beside the picture", async () => {
		const places = Buffer.from([1, 2, 3, 4, 5, 6]);
		const data = cbfFile({ compression: 0, width: 2, height: 1, body: places });
		const alpha = Buffer.alloc(0x10 + 4, 0x00);
		alpha.write("ALP1", 0, "latin1");
		alpha.writeInt32LE(2, 8);
		alpha[0x10] = 0x40;
		alpha[0x11] = 1;
		alpha[0x12] = 0x80;
		alpha[0x13] = 1;
		await withCompanionFiles(
			"picture.cbf",
			{ "picture.alp": alpha },
			async (mainPath) => {
				const bmp = await extract(data, mainPath);
				expect(bmp.readUInt16LE(0x1c)).toBe(32);
				expect(bmp.subarray(0x36, 0x3e).toString("hex")).toBe(
					hex([1, 2, 3, 0x40, 4, 5, 6, 0x80]),
				);
			},
		);
	});

	it("declines a file that does not hold a picture", async () => {
		const other = cbfFile({
			compression: 0,
			width: 2,
			height: 1,
			body: Buffer.alloc(6),
			word: "CBF4",
		});
		await expect(
			abelCbfImageFormat.open(new BufferByteSource(other), "picture.cbf"),
		).rejects.toThrow(GarbroError);
		await expect(
			abelCbfImageFormat.open(new BufferByteSource(other), "picture.cbf"),
		).rejects.toThrow("Not an Abel picture");
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
