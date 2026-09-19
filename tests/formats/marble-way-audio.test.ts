import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeWady,
	marbleWadyAudioFormat,
	readWadyLayout,
} from "../../packages/formats/src/marble/way-audio.js";

/** The head of a sound: the word, what a step is multiplied by, the size of the samples and the shape. */
function wadyFile(input: {
	multiplier: number;
	sourceSize: number;
	channels: number;
	body: Buffer;
}): Buffer {
	const head = Buffer.alloc(0x30, 0x00);
	head.write("WADY", 0, "latin1");
	head[5] = input.multiplier;
	head.writeInt32LE(input.sourceSize, 0x0c);
	head.writeUInt16LE(1, 0x20);
	head.writeUInt16LE(input.channels, 0x22);
	head.writeUInt32LE(22050, 0x24);
	head.writeUInt32LE(22050 * 2, 0x28);
	head.writeUInt16LE(2, 0x2c);
	head.writeUInt16LE(16, 0x2e);
	return Buffer.concat([head, input.body]);
}

/** The walk of the runs of one channel: the size it gives, how many items stand there, a sample and them. */
function runs(count: number, first: number, items: number[]): Buffer {
	const head = Buffer.alloc(8, 0x00);
	head.writeInt32LE(0x100, 0);
	head.writeInt32LE(count, 4);
	const sample = Buffer.alloc(2, 0x00);
	sample.writeInt16LE(first, 0);
	return Buffer.concat([head, sample, Buffer.from(items)]);
}

const PLAIN_BYTES = Buffer.from([0x80, 0x01, 0x81, 0x02]);
/** The four samples the walk of one byte each gives with a multiplier of two: 0, 4, 512 and 520. */
const PLAIN_MONO = hex([0, 0, 4, 0, 0, 2, 8, 2]);
/**
 * The same walk of two channels: the left channel takes the first and the third byte of the walk and the
 * right channel the second and the fourth, so the samples are 0 and 512 beside 2 and 6.
 */
const PLAIN_STEREO = hex([0, 0, 2, 0, 0, 2, 6, 0]);
/** A run of three samples between 256 and 96: 256, 202, 149 and 95. */
const RUNS_MONO = hex([0, 1, 0xca, 0, 0x95, 0, 0x5f, 0]);
/** One step of a sample whose places name it: 256 and 260. */
const RUNS_STEP = hex([0, 1, 4, 1]);

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await marbleWadyAudioFormat.open(
		new BufferByteSource(data),
		"sound.way",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Marble engine wave audio", () => {
	it("reads the head of a sound", () => {
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 1,
			body: PLAIN_BYTES,
		});
		expect(readWadyLayout(data)).toEqual({
			multiplier: 2,
			sourceSize: 4,
			format: {
				formatTag: 1,
				channels: 1,
				sampleRate: 22050,
				averageBytesPerSecond: 44100,
				blockAlign: 2,
				bitsPerSample: 16,
			},
			plain: true,
		});
		// Where the size the head names is not the size of what stands behind it, the samples stand as runs.
		const runsData = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 1,
			body: runs(1, 0x100, [0x60, 0x00]),
		});
		expect(readWadyLayout(runsData)?.plain).toBe(false);
		const other = Buffer.from(data);
		other.write("WADX", 0, "latin1");
		expect(readWadyLayout(other)).toBeUndefined();
		expect(readWadyLayout(Buffer.alloc(8, 0x00))).toBeUndefined();
	});

	it("walks one byte at a time for one channel", () => {
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 1,
			body: PLAIN_BYTES,
		});
		const layout = readWadyLayout(data);
		if (!layout) throw new Error("no layout");
		// A byte whose highest place stands is a sample of its own, the other bytes step the sample along.
		expect(decodeWady(data, layout).toString("hex")).toBe(PLAIN_MONO);
	});

	it("walks one byte at a time for two channels", () => {
		const data = wadyFile({
			multiplier: 1,
			sourceSize: 4,
			channels: 2,
			body: PLAIN_BYTES,
		});
		const layout = readWadyLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWady(data, layout).toString("hex")).toBe(PLAIN_STEREO);
	});

	it("walks the runs of one channel", () => {
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 1,
			body: runs(1, 0x100, [0x60, 0x00]),
		});
		const layout = readWadyLayout(data);
		if (!layout) throw new Error("no layout");
		// An item whose lowest place does not stand names the end of a run and how many samples stand
		// between it and the sample at hand: three samples between 256 and 96. What the walk gives is what
		// the reference's own arithmetic in doubles gives, where the third step stands a hair below 96 and
		// is cut to 95.
		expect(decodeWady(data, layout).toString("hex")).toBe(RUNS_MONO);
	});

	it("walks a run of a sample whose places name it", () => {
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 2,
			channels: 1,
			body: runs(1, 0x100, [0x03]),
		});
		const layout = readWadyLayout(data);
		if (!layout) throw new Error("no layout");
		// The item `0x03` stands for the step of the second table numbered one, which adds four.
		expect(decodeWady(data, layout).toString("hex")).toBe(RUNS_STEP);
	});

	it("walks the runs of two channels side by side", () => {
		// The left channel gives four samples and the right one two, the two standing side by side: what is
		// left of the second channel stands as nought. The very first sample of a channel is written without
		// the walk stepping over the room of the other channel — which is what the reference does — so the
		// two channels stand one sample apart at the beginning and the second sample of the left channel is
		// covered by the first sample of the right one.
		const left = runs(1, 0x100, [0x60, 0x00]);
		const right = runs(1, 0x100, [0x03]);
		const channelSize = left.length - 4;
		const head = Buffer.alloc(4, 0x00);
		head.writeInt32LE(channelSize, 0);
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 2,
			body: Buffer.concat([head, left, right]),
		});
		const layout = readWadyLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeWady(data, layout).toString("hex")).toBe(
			hex([0, 1, 0, 1, 4, 1, 0x95, 0, 0, 0, 0x5f, 0]),
		);
	});

	it("writes a sound out as a wave file", async () => {
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 1,
			body: PLAIN_BYTES,
		});
		const out = await extract(data);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(out.subarray(0x24, 0x28).toString("latin1")).toBe("data");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt32LE(0x28)).toBe(8);
		expect(out.subarray(0x2c).toString("hex")).toBe(PLAIN_MONO);
	});

	it("declines a file that does not hold a sound", async () => {
		const other = wadyFile({
			multiplier: 2,
			sourceSize: 4,
			channels: 1,
			body: PLAIN_BYTES,
		});
		other.write("WADX", 0, "latin1");
		await expect(
			marbleWadyAudioFormat.open(new BufferByteSource(other), "sound.way"),
		).rejects.toThrow(GarbroError);
		await expect(
			marbleWadyAudioFormat.open(new BufferByteSource(other), "sound.way"),
		).rejects.toThrow("Not a Marble engine sound");
	});

	it("stops where the walk runs out of the file", () => {
		const data = wadyFile({
			multiplier: 2,
			sourceSize: 8,
			channels: 1,
			body: runs(1, 0x100, [0x60, 0x00]),
		});
		const layout = readWadyLayout(data);
		if (!layout) throw new Error("no layout");
		// The walk has a whole run of its own at the end: four samples stand between the sample and the end.
		expect(() => decodeWady(data, layout)).not.toThrow();
		const short = wadyFile({
			multiplier: 2,
			sourceSize: 8,
			channels: 1,
			body: Buffer.concat([runs(1, 0x100, [0x60, 0x00]).subarray(0, 9)]),
		});
		const shortLayout = readWadyLayout(short);
		if (!shortLayout) throw new Error("no layout");
		expect(() => decodeWady(short, shortLayout)).toThrow(
			"Marble sound is cut short of its walk",
		);
	});
});

/** The bytes of a sound, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
