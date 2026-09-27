import { describe, expect, it } from "vitest";
import {
	B_DC_PRED,
	buildVp8Quantisers,
	createVp8MacroblockState,
	readVp8MacroblockModes,
	readVp8MacroblockResiduals,
} from "../../packages/formats/src/shared/webp-vp8-macroblock.js";
import {
	readVp8FrameHeader,
	readVp8PartitionHeader,
	Vp8BooleanDecoder,
} from "../../packages/formats/src/shared/webp-vp8.js";
import {
	LOSSY_HIGH_WEBP,
	LOSSY_LOW_WEBP,
	LOSSY_WEBP,
	PILLAR_PLAIN_WEBP,
} from "../helpers/webp.js";

/** The places of the file of the picture of the format of the colour of the places of the picture of a picture of
 * the format of the web. */
function pictureOf(data: Buffer): Buffer {
	let at = 12;
	while (at + 8 <= data.length) {
		const type = data.toString("latin1", at, at + 4);
		const size = data.readUInt32LE(at + 4);
		if ("VP8 " === type) return data.subarray(at + 8, at + 8 + size);
		at += 8 + size + (size & 1);
	}
	throw new Error(
		"no picture of the colour of the places of the picture of the format",
	);
}

/** Walks the counts of the head of the format of the picture of the places of the file of the picture of the format
 * of a picture of the format of the web, of the walk of the library of the picture of the web: the counts of the head
 * of the format of the picture of the places of the file of the picture of the format of the places of the file
 * square stand of the places of the file of the picture of the format of the picture of the format, of the counts of
 * the head of the format of the picture of the places of the file standing of the places of the file of the picture of
 * the format (the two kinds of the counts of the head of the format of the picture of the places of the file stand of
 * places of the file of their own). */
function walkPicture(data: Buffer) {
	const frame = readVp8FrameHeader(pictureOf(data));
	const header = readVp8PartitionHeader(frame.partition);
	if (1 !== header.tokenPartitions)
		throw new Error(
			"the picture of the format stands of counts of the head of the format of the places of the file of their own",
		);
	const first = new Vp8BooleanDecoder(frame.partition);
	const tokens = new Vp8BooleanDecoder(
		frame.payload.subarray(frame.firstPartSize),
	);
	const quantisers = buildVp8Quantisers(header);
	const mbWidth = Math.ceil(frame.width / 16);
	const mbHeight = Math.ceil(frame.height / 16);
	const state = createVp8MacroblockState(mbWidth);
	let nonZero = 0;
	let largest = 0;
	for (let y = 0; y < mbHeight; y += 1) {
		const modes = [];
		for (let x = 0; x < mbWidth; x += 1)
			modes.push(
				readVp8MacroblockModes(
					first,
					state,
					x,
					header.segmentation,
					header.useSkipProbability,
					header.skipProbability,
				),
			);
		for (let x = 0; x < mbWidth; x += 1) {
			const mode = modes[x];
			if (!mode) throw new Error("no counts of the head of the format");
			const residuals = readVp8MacroblockResiduals(
				tokens,
				state,
				x,
				mode,
				quantisers[mode.segment] ?? (quantisers[0] as never),
				header.probabilities,
			);
			for (const value of residuals.coefficients)
				if (0 !== value) {
					nonZero += 1;
					largest = Math.max(largest, Math.abs(value));
				}
		}
	}
	return { frame, header, first, tokens, nonZero, largest };
}

describe("the walk of the counts of the head of the format of the picture of the web of the places of the file", () => {
	it("walks the counts of the head of the format of a partition of no set places of the file", () => {
		const first = new Vp8BooleanDecoder(Buffer.alloc(64));
		const tokens = new Vp8BooleanDecoder(Buffer.alloc(64));
		const header = readVp8PartitionHeader(Buffer.alloc(64));
		const state = createVp8MacroblockState(1);
		const modes = readVp8MacroblockModes(
			first,
			state,
			0,
			header.segmentation,
			header.useSkipProbability,
			header.skipProbability,
		);
		expect(modes).toMatchObject({
			segment: 0,
			skip: false,
			fourByFour: true,
			colourMode: B_DC_PRED,
		});
		expect([...modes.modes]).toEqual([
			0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
		]);
		const residuals = readVp8MacroblockResiduals(
			tokens,
			state,
			0,
			modes,
			buildVp8Quantisers(header)[0] as never,
			header.probabilities,
		);
		expect(residuals.skipped).toBe(false);
		expect([...residuals.coefficients]).toEqual([...new Int16Array(384)]);
	});

	it("walks the counts of the head of the format of the picture of the format of four places of the file", () => {
		const walked = walkPicture(LOSSY_WEBP);
		expect(walked.frame.width).toBe(4);
		expect(walked.frame.height).toBe(3);
		expect(walked.first.walked).toBeLessThanOrEqual(
			walked.frame.partition.length * 8,
		);
		expect(walked.tokens.walked).toBeLessThanOrEqual(
			(walked.frame.payload.length - walked.frame.firstPartSize) * 8,
		);
	});

	it("walks the counts of the head of the format of the picture of the format of the counts of the places of the file of their own", () => {
		const walked = walkPicture(PILLAR_PLAIN_WEBP);
		expect(walked.nonZero).toBeGreaterThan(0);
		expect(walked.largest).toBeLessThanOrEqual(4096);
		expect(walked.tokens.walked).toBeGreaterThan(0);
		const again = walkPicture(PILLAR_PLAIN_WEBP);
		expect(again.nonZero).toBe(walked.nonZero);
		expect(again.tokens.walked).toBe(walked.tokens.walked);
	});

	it("stands the counts of the head of the format of the picture of the colours of the picture of the places of the file of the picture of the count of the head of the picture of the format of four places of the file", () => {
		const header = readVp8PartitionHeader(
			readVp8FrameHeader(pictureOf(PILLAR_PLAIN_WEBP)).partition,
		);
		const quantisers = buildVp8Quantisers(header);
		expect(quantisers).toHaveLength(4);
		expect(header.segmentation.use).toBe(true);
		expect(quantisers[1]?.picture[0]).not.toBe(quantisers[0]?.picture[0]);
		for (const quantiser of quantisers) {
			expect(quantiser.picture[0]).toBeGreaterThan(0);
			expect(quantiser.picture[1]).toBeGreaterThan(0);
			expect(quantiser.secondOrder[0]).toBeGreaterThan(0);
			expect(quantiser.secondOrder[1]).toBeGreaterThanOrEqual(8);
			expect(quantiser.colour[0]).toBeGreaterThan(0);
			expect(quantiser.colour[1]).toBeGreaterThan(0);
		}
	});

	it("stands of the counts of the head of the format of the picture of the colours of the picture of the places of the file of the two kinds of the counts of the head of the format of the picture of the two places of the file", () => {
		// A picture of the count of the head of the format of the two places of the file of ten stands of the counts of
		// the head of the picture of the format of the picture of the format beyond a picture of the count of the head
		// of the format of the two places of the file of ninety: the walk of the library of the picture of the web
		// writes no picture of the format of the places of the file of the colour of the picture of the format itself.
		const low = buildVp8Quantisers(
			readVp8PartitionHeader(
				readVp8FrameHeader(pictureOf(LOSSY_LOW_WEBP)).partition,
			),
		);
		const high = buildVp8Quantisers(
			readVp8PartitionHeader(
				readVp8FrameHeader(pictureOf(LOSSY_HIGH_WEBP)).partition,
			),
		);
		expect(low[0]?.picture[0]).toBeGreaterThanOrEqual(high[0]?.picture[0] ?? 0);
		expect(low[0]?.picture[1]).toBeGreaterThanOrEqual(high[0]?.picture[1] ?? 0);
	});
});
