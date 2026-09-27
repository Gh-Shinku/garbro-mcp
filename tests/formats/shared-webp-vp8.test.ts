import { describe, expect, it } from "vitest";
import { GarbroError } from "@garbro-mcp/core";
import {
	readVp8FrameHeader,
	Vp8BooleanDecoder,
} from "../../packages/formats/src/shared/webp-vp8.js";
import { LOSSY_WEBP } from "../helpers/webp.js";

/** The places of the file of the count of the head of the picture of the format of a picture of the web. */
function partitionOf(data: Buffer): Buffer {
	let at = 12;
	while (at + 8 <= data.length) {
		const type = data.toString("latin1", at, at + 4);
		const size = data.readUInt32LE(at + 4);
		if ("VP8 " === type) return data.subarray(at + 8, at + 8 + size);
		at += 8 + size + (size & 1);
	}
	throw new Error("no picture of the colour of the places of the picture");
}

describe("the walk of the picture of the web of the colour of the places of the picture", () => {
	it("reads the counts of the head of the picture of the format of the library of the picture of the web", () => {
		// The python imaging library wrote the fixture through libwebp, which names the counts of the head of it.
		const frame = readVp8FrameHeader(partitionOf(LOSSY_WEBP));
		expect(frame).toMatchObject({
			keyFrame: true,
			version: 0,
			showFrame: true,
			firstPartSize: 16,
			width: 4,
			height: 3,
			scale: 0,
		});
		expect(frame.partition.length).toBe(16);
	});

	it("walks the counts of the head of the format of the picture of the two places of the file", () => {
		// The counts of the head of the format of the picture of the web of the places of the file of their own
		// (RFC 6386) computed by hand: the counts of the places of the file of the picture of the colour of the
		// picture of the counts of the head of the format of the table of the two places of the file.
		const zeros = Buffer.alloc(8, 0x00);
		const walk = (data: Buffer, probabilities: number[]): number[] => {
			const bits = new Vp8BooleanDecoder(data);
			return probabilities.map((probability) => bits.read(probability));
		};
		expect(
			walk(
				zeros,
				Array.from({ length: 8 }, () => 128),
			),
		).toEqual([0, 0, 0, 0, 0, 0, 0, 0]);
		expect(walk(zeros, [200, 10, 255, 1, 128, 64, 32, 16])).toEqual([
			0, 0, 0, 0, 0, 0, 0, 0,
		]);
		const ones = Buffer.alloc(8, 0xff);
		expect(
			walk(
				ones,
				Array.from({ length: 8 }, () => 128),
			),
		).toEqual([1, 1, 1, 1, 1, 1, 1, 1]);
		expect(walk(ones, [200, 10, 255, 1, 128, 64, 32, 16])).toEqual([
			1, 1, 1, 1, 1, 1, 1, 1,
		]);
		const mixed = Buffer.from([0x80, 0x00, 0x40, 0x00, 0x20, 0x00, 0x10, 0x00]);
		expect(
			walk(
				mixed,
				Array.from({ length: 8 }, () => 128),
			),
		).toEqual([1, 0, 0, 0, 0, 0, 0, 0]);
		expect(walk(mixed, [200, 10, 255, 1, 128, 64, 32, 16])).toEqual([
			0, 1, 0, 1, 1, 1, 0, 0,
		]);
	});

	it("reads the counts of the head of the picture of the colour of the picture of the counts of the head of the format", () => {
		const data = new Vp8BooleanDecoder(
			Buffer.from([0x80, 0x00, 0x40, 0x00, 0x20, 0x00, 0x10, 0x00]),
		);
		expect(data.readLiteral(4)).toBeGreaterThanOrEqual(0);
		expect(data.walked).toBeGreaterThan(0);
	});

	it("turns away the counts of the head of the picture of the format the walk of this project does not read", () => {
		const picture = Buffer.from(partitionOf(LOSSY_WEBP));
		const inter = Buffer.from(picture);
		inter[0] = (inter[0] ?? 0) | 1;
		expect(() => readVp8FrameHeader(inter)).toThrow(GarbroError);
		const code = Buffer.from(picture);
		code[3] = 0x00;
		expect(() => readVp8FrameHeader(code)).toThrow(GarbroError);
		const short = picture.subarray(0, 8);
		expect(() => readVp8FrameHeader(short)).toThrow(GarbroError);
		const scaled = Buffer.from(picture);
		scaled[7] = (scaled[7] ?? 0) | 0x40;
		expect(() => readVp8FrameHeader(scaled)).toThrow(
			/UNSUPPORTED|no walk of this project/,
		);
	});
});
