import { Buffer } from "node:buffer";
import { describe, expect, it } from "vitest";
import {
	decompressDxt1Block,
	decompressDxt3Block,
	decompressDxt5Block,
	unpackDxt1,
	unpackDxt3,
	unpackDxt5,
} from "../../packages/formats/src/shared/dxt.js";

/** The bytes of a row, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}

/** A block of the first kind: two colours and two places a pixel. */
function dxt1Block(color0: number, color1: number, map = 0xe4e4e4e4): Buffer {
	const block = Buffer.alloc(8, 0x00);
	block.writeUInt16LE(color0, 0);
	block.writeUInt16LE(color1, 2);
	block.writeUInt32LE(map >>> 0, 4);
	return block;
}

/** A block of the third kind: sixteen places of alpha of four bits in front of the colours. */
function dxt3Block(
	color0: number,
	color1: number,
	alpha: number,
	map = 0xe4e4e4e4,
): Buffer {
	const block = Buffer.alloc(16, 0x00);
	block.fill(alpha, 0, 8);
	block.writeUInt16LE(color0, 8);
	block.writeUInt16LE(color1, 10);
	block.writeUInt32LE(map >>> 0, 12);
	return block;
}

/** The six bytes of sixteen places of alpha of three bits. */
function alphaCodes(codes: number[]): Buffer {
	const bytes = Buffer.alloc(6, 0x00);
	let at = 0;
	for (let half = 0; half < 2; half += 1) {
		let block = 0;
		for (let index = 0; index < 8; index += 1) {
			block |= (codes[half * 8 + index] ?? 0) << (3 * index);
		}
		bytes.writeUIntLE(block, at, 3);
		at += 3;
	}
	return bytes;
}

/** A block of the fifth kind: two places of alpha of a byte each and three places a pixel. */
function dxt5Block(
	alpha0: number,
	alpha1: number,
	codes: number[],
	color0: number,
	color1: number,
	map = 0xe4e4e4e4,
): Buffer {
	const block = Buffer.alloc(16, 0x00);
	block[0] = alpha0;
	block[1] = alpha1;
	alphaCodes(codes).copy(block, 2);
	block.writeUInt16LE(color0, 8);
	block.writeUInt16LE(color1, 10);
	block.writeUInt32LE(map >>> 0, 12);
	return block;
}

/** The four pixels of the first row of a picture of four by four pixels. */
function firstRow(pixels: Buffer): string {
	return pixels.subarray(0, 16).toString("hex");
}

describe("DXT block decoder", () => {
	it("walks a block of the first kind with a fourth colour of nought", () => {
		// The second colour stands above the first, so the fourth colour lets the pixels see through.
		const output = Buffer.alloc(4 * 4 * 4, 0x00);
		decompressDxt1Block(dxt1Block(0x0000, 0xffff), 0, output, 16, 0, 0, 4, 4);
		// Two colours of black and white, half way between them and then nought at all — every row the same.
		expect(firstRow(output)).toBe(
			hex([0, 0, 0, 255, 255, 255, 255, 255, 127, 127, 127, 255, 0, 0, 0, 0]),
		);
		for (let row = 1; row < 4; row += 1) {
			expect(output.subarray(row * 16, row * 16 + 16).toString("hex")).toBe(
				firstRow(output),
			);
		}
	});

	it("walks a block of the first kind as one without alpha", () => {
		// The second colour stands below the first, so the two places of interpolation are two thirds and
		// one third of the way between them.
		const output = Buffer.alloc(4 * 4 * 4, 0x00);
		decompressDxt1Block(dxt1Block(0xffff, 0x0000), 0, output, 16, 0, 0, 4, 4);
		// White, black, two thirds of the way from white to black and then one third of it.
		expect(firstRow(output)).toBe(
			hex([
				255, 255, 255, 255, 0, 0, 0, 255, 170, 170, 170, 255, 85, 85, 85, 255,
			]),
		);
	});

	it("walks a block of the third kind with sixteen places of alpha", () => {
		// Four places of alpha spread over a byte each, the lower place first, and the two places of
		// interpolation of the kind that has no fourth colour of its own.
		const output = Buffer.alloc(4 * 4 * 4, 0x00);
		decompressDxt3Block(
			dxt3Block(0xffff, 0x0000, 0xf0),
			0,
			output,
			16,
			0,
			0,
			4,
			4,
		);
		// White and black with the places of alpha nought and the whole, then the two places of
		// interpolation with the same places of alpha again.
		expect(firstRow(output)).toBe(
			hex([255, 255, 255, 0, 0, 0, 0, 255, 170, 170, 170, 0, 85, 85, 85, 255]),
		);
		// The places of alpha stand a pixel at a time along a row of the block.
		expect(output.subarray(16, 32).toString("hex")).toBe(firstRow(output));
	});

	it("walks a block of the fifth kind with eight steps of alpha", () => {
		const output = Buffer.alloc(4 * 4 * 4, 0x00);
		// Every place stands at the first of the two, so every pixel takes it.
		decompressDxt5Block(
			dxt5Block(
				200,
				100,
				Array.from({ length: 16 }, () => 0),
				0xf800,
				0x001f,
			),
			0,
			output,
			16,
			0,
			0,
			4,
			4,
		);
		// Every place stands at the first of the two, and the colours take the four places of the word.
		expect(firstRow(output)).toBe(
			hex([0, 0, 255, 200, 255, 0, 0, 200, 85, 0, 170, 200, 170, 0, 85, 200]),
		);
		// The six steps between the two places, the first standing above the second.
		const steps = Buffer.alloc(4 * 4 * 4, 0x00);
		decompressDxt5Block(
			dxt5Block(
				200,
				100,
				[0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7],
				0xf800,
				0x001f,
			),
			0,
			steps,
			16,
			0,
			0,
			4,
			4,
		);
		// Two hundred, one hundred, and then six steps between them: 185, 171, 157, 142, 128 and 114.
		expect(steps.subarray(3, 4).toString("hex")).toBe("c8");
		expect(steps.subarray(7, 8).toString("hex")).toBe("64");
		expect(steps.subarray(11, 12).toString("hex")).toBe("b9");
		expect(steps.subarray(15, 16).toString("hex")).toBe("ab");
		expect(steps.subarray(19, 20).toString("hex")).toBe("9d");
		expect(steps.subarray(23, 24).toString("hex")).toBe("8e");
		expect(steps.subarray(27, 28).toString("hex")).toBe("80");
		expect(steps.subarray(31, 32).toString("hex")).toBe("72");
	});

	it("walks a block of the fifth kind where the first place does not stand above the second", () => {
		const output = Buffer.alloc(4 * 4 * 4, 0x00);
		decompressDxt5Block(
			dxt5Block(
				100,
				200,
				[0, 1, 2, 3, 4, 5, 6, 7, 0, 1, 2, 3, 4, 5, 6, 7],
				0xf800,
				0x001f,
			),
			0,
			output,
			16,
			0,
			0,
			4,
			4,
		);
		// Two places and then four steps between them, with the last two standing at nought and the whole.
		const alphas = [100, 200, 120, 140, 160, 180, 0, 255];
		for (let index = 0; index < 8; index += 1) {
			expect(
				output.subarray(index * 4 + 3, index * 4 + 4).toString("hex"),
			).toBe((alphas[index] ?? 0).toString(16).padStart(2, "0"));
		}
		// The fourth colour steps two thirds and one third of the way from the second colour to the first.
		expect(output.subarray(28, 32).toString("hex")).toBe(
			hex([170, 0, 85, 255]),
		);
	});

	it("walks the blocks of a picture wider than one block", () => {
		// Six by six pixels: four blocks, the ones on the right and at the bottom reaching past the picture.
		const input = Buffer.concat([
			dxt1Block(0xffff, 0x0000, 0x00000000), // white
			dxt1Block(0x0000, 0xffff, 0x00000000), // black
			dxt1Block(0x0000, 0xffff, 0x00000000), // black
			dxt1Block(0xffff, 0x0000, 0x00000000), // white
		]);
		const pixels = unpackDxt1(input, 6, 6);
		expect(pixels.length).toBe(6 * 4 * 6);
		const stride = 6 * 4;
		// The first block is white and the second black, the second reaching over the two last pixels of
		// the row and no further.
		expect(pixels.subarray(0, 4).toString("hex")).toBe(
			hex([255, 255, 255, 255]),
		);
		expect(pixels.subarray(16, 20).toString("hex")).toBe(hex([0, 0, 0, 255]));
		expect(pixels.subarray(20, 24).toString("hex")).toBe(hex([0, 0, 0, 255]));
		// The blocks of the second row of blocks stand behind those of the first.
		expect(pixels.subarray(stride * 4, stride * 4 + 4).toString("hex")).toBe(
			hex([0, 0, 0, 255]),
		);
		expect(
			pixels.subarray(stride * 4 + 16, stride * 4 + 20).toString("hex"),
		).toBe(hex([255, 255, 255, 255]));
		// The last pixel of the picture stands where the last block of the last row of blocks puts it.
		expect(
			pixels.subarray(stride * 5 + 20, stride * 5 + 24).toString("hex"),
		).toBe(hex([255, 255, 255, 255]));
	});

	it("walks a picture of every kind of block", () => {
		expect(unpackDxt1(dxt1Block(0xffff, 0x0000), 4, 4).length).toBe(64);
		expect(unpackDxt3(dxt3Block(0xffff, 0x0000, 0xff), 4, 4).length).toBe(64);
		expect(
			unpackDxt5(
				dxt5Block(
					255,
					0,
					Array.from({ length: 16 }, () => 0),
					0xffff,
					0x0000,
				),
				4,
				4,
			).length,
		).toBe(64);
	});
});
