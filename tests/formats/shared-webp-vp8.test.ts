import { describe, expect, it } from "vitest";
import { GarbroError } from "@garbro-mcp/core";
import {
	readVp8FrameHeader,
	readVp8PartitionHeader,
	Vp8BooleanDecoder,
	readVp8TokenPartitions,
} from "../../packages/formats/src/shared/webp-vp8.js";
import { DEFAULT_COEFFICIENT_PROBABILITIES } from "../../packages/formats/src/shared/webp-vp8-tables.js";
import {
	LOSSY_HIGH_WEBP,
	LOSSY_LOW_WEBP,
	LOSSY_WEBP,
	PILLAR_PLAIN_WEBP,
} from "../helpers/webp.js";

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

	it("reads the counts of the head of the format of the places of the file of the picture of the format of the counts of the head of the format of the picture of the two places of the file", () => {
		// The python imaging library wrote the two fixtures of the counts of the head of the format of the picture of
		// the two places of the file alone, so that the counts of the head of the format of the picture of the
		// colours of the picture of the two of them stand of counts of their own: a picture of a count of the head
		// of the format of the picture of the places of the file of the count of the head of the format 10 stands of
		// no count of the head of the format of the picture of the format beyond the one of a picture of the count of
		// the head of the format 90.
		const low = readVp8PartitionHeader(
			readVp8FrameHeader(partitionOf(LOSSY_LOW_WEBP)).partition,
		);
		const high = readVp8PartitionHeader(
			readVp8FrameHeader(partitionOf(LOSSY_HIGH_WEBP)).partition,
		);
		expect(low.quantiser.base).toBeGreaterThanOrEqual(high.quantiser.base);
		expect(low.walked).toBeGreaterThan(0);
		expect(high.walked).toBeGreaterThan(0);
	});

	it("reads the counts of the head of the format of the first partition of the picture of the format", () => {
		const frame = readVp8FrameHeader(partitionOf(PILLAR_PLAIN_WEBP));
		const header = readVp8PartitionHeader(frame.partition);
		expect(header.filter.level).toBeLessThanOrEqual(63);
		expect(header.filter.sharpness).toBeLessThanOrEqual(7);
		expect(header.quantiser.base).toBeLessThanOrEqual(127);
		expect([1, 2, 4, 8]).toContain(header.tokenPartitions);
		expect(header.walked).toBeLessThanOrEqual(frame.partition.length * 8);
		expect(header.probabilities.length).toBe(1056);
		// The python imaging library wrote the fixture of the counts of the head of the format of the picture of the
		// format itself of the library of the picture of the web (`method` 4, of no counts of their own of the walk of
		// the places of the file): the counts of the head of the format of the picture of the places of the file stand
		// of the counts of the head of the format of the picture of the places of the file of their own of that
		// library (`src/enc/config_enc.c`: the counts of the head of the format of the picture of the places of the
		// file stand of four, the walk of the picture of the format of the strong kind, the count of the head of the
		// format of the picture of the sharp places of the file stands of no count, of no counts of the head of the
		// format of the picture of the places of the file).
		expect(header.segmentation.use).toBe(true);
		expect(header.segmentation.updateMap).toBe(true);
		expect(header.filter.simple).toBe(false);
		expect(header.filter.sharpness).toBe(0);
		expect(header.tokenPartitions).toBe(1);
		expect(header.quantiser.base).toBeGreaterThan(0);
		expect(
			header.probabilities.some(
				(value, at) => value !== DEFAULT_COEFFICIENT_PROBABILITIES[at],
			),
		).toBe(true);
	});

	it("reads the counts of the head of the format of the first partition of the picture of the format of four places of the file", () => {
		const frame = readVp8FrameHeader(partitionOf(LOSSY_WEBP));
		const header = readVp8PartitionHeader(frame.partition);
		expect(header.walked).toBeGreaterThan(0);
		expect(header.walked).toBeLessThanOrEqual(frame.partition.length * 8);
		expect([1, 2, 4, 8]).toContain(header.tokenPartitions);
		expect(header.quantiser.base).toBeLessThanOrEqual(127);
	});

	it("stands of the counts of the head of the format of the picture of the format itself of a partition of no places of the file", () => {
		// A first partition of no set places of the file carries no count of the head of the format of the picture of
		// the places of the file: the walk of the library of the picture of the web reads every such count as the
		// count of the head of the format of the picture of the format itself.
		const header = readVp8PartitionHeader(Buffer.alloc(32));
		expect(header).toMatchObject({
			colourSpace: 0,
			clampType: 0,
			tokenPartitions: 1,
			refreshEntropy: false,
			useSkipProbability: false,
			skipProbability: 128,
			segmentation: { use: false, updateMap: false, absolute: true },
			filter: {
				simple: false,
				level: 0,
				sharpness: 0,
				referenceDeltas: [0, 0, 0, 0],
				modeDeltas: [0, 0, 0, 0],
			},
			quantiser: { base: 0, y1dc: 0, y2dc: 0, y2ac: 0, uvdc: 0, uvac: 0 },
		});
		expect([...header.probabilities]).toEqual([
			...DEFAULT_COEFFICIENT_PROBABILITIES,
		]);
	});

	it("splits the token partitions of a picture with four of them", () => {
		// A picture whose first partition stands of two places of the file, with a table of three sizes in little
		// endian order (three, one and two places of the file) and the partitions themselves after the table. The
		// last partition stands of no count of the head of the format of the places of the file and runs to the end
		// of the token data.
		const payload = Buffer.from([
			0x00,
			0x00, // the first partition
			0x03,
			0x00,
			0x00, // the size of the first token partition, three places of the file
			0x01,
			0x00,
			0x00, // the size of the second, one place of the file
			0x02,
			0x00,
			0x00, // the size of the third, two places of the file
			0x11,
			0x12,
			0x13,
			0x21,
			0x31,
			0x32,
			0x41,
			0x42,
			0x43,
			0x44,
		]);
		const frame = { payload, firstPartSize: 2 } as unknown as Parameters<
			typeof readVp8TokenPartitions
		>[0];
		expect(readVp8TokenPartitions(frame, 1).map((p) => [...p])).toEqual([
			[...payload.subarray(2)],
		]);
		expect(readVp8TokenPartitions(frame, 4).map((p) => [...p])).toEqual([
			[0x11, 0x12, 0x13],
			[0x21],
			[0x31, 0x32],
			[0x41, 0x42, 0x43, 0x44],
		]);
	});

	it("turns down token partitions whose counts of the head of the format stand beyond the picture", () => {
		const frame = {
			payload: Buffer.from([0, 0, 0]),
			firstPartSize: 0,
		} as unknown as Parameters<typeof readVp8TokenPartitions>[0];
		expect(() => readVp8TokenPartitions(frame, 4)).toThrow(
			/beyond the places of the file/,
		);
	});
});
