import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	aypioVocAudioFormat,
	buildVocSamples,
	decodeVoc,
	readVocLayout,
} from "../../packages/formats/src/aypio/voc-audio.js";

/** A UK2 engine sound: the word, the head of the walk and the walk of its nibbles. */
function vocFile(input: {
	sampleCount: number;
	channels: number;
	bits: number;
	previous: [number, number];
	first: [number, number];
	body: Buffer;
	dataOffset?: number;
}): Buffer {
	const head = Buffer.alloc(0x3c, 0x00);
	head.write("\x57\x41\x56\x81", 0, "latin1");
	head.writeUInt32LE(input.dataOffset ?? 0x3c, 4);
	head[8] = input.channels;
	head[0x0a] = input.first[0] & 0xff;
	head[0x0b] = (input.first[0] >> 8) & 0xff;
	head[0x0c] = input.previous[0];
	head[0x0e] = input.first[1] & 0xff;
	head[0x0f] = (input.first[1] >> 8) & 0xff;
	head[0x10] = input.previous[1];
	head.writeInt32LE(input.sampleCount, 0x18);
	head[0x20] = input.bits;
	head.writeUInt16LE(1, 0x21);
	head.writeUInt16LE(input.channels, 0x23);
	head.writeUInt32LE(22050, 0x25);
	head.writeUInt32LE(22050 * 2, 0x29);
	head.writeUInt16LE(2, 0x2d);
	head.writeUInt16LE(16, 0x2f);
	head.write("RIFF", 0x38, "latin1");
	return Buffer.concat([head, input.body]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await aypioVocAudioFormat.open(
		new BufferByteSource(data),
		"sound.voc",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("UK2 engine compressed audio", () => {
	it("works the steps of the walk out for every place of a sample", () => {
		const samples = buildVocSamples(4);
		expect(
			Array.from(samples.slice(0, 89 * 8)).filter((_, at) => at % 89 === 0),
		).toEqual([0, 2, 4, 6, 7, 9, 11, 13]);
	});

	it("reads the head of a sound", () => {
		const data = vocFile({
			sampleCount: 6,
			channels: 1,
			bits: 4,
			previous: [0, 0],
			first: [0x100, 0x200],
			body: Buffer.from([0x01, 0x89, 0x02]),
		});
		expect(readVocLayout(data)).toEqual({
			format: {
				formatTag: 1,
				channels: 1,
				sampleRate: 22050,
				averageBytesPerSecond: 44100,
				blockAlign: 2,
				bitsPerSample: 16,
			},
			sampleCount: 6,
			channels: 1,
			bitsPerSample: 4,
			previous: [0, 0],
			first: [0x100, 0x200],
			dataOffset: 0x3c,
		});
		const other = Buffer.from(data);
		other.write("\x57\x41\x56\x82", 0, "latin1");
		expect(readVocLayout(other)).toBeUndefined();
		const noRiff = Buffer.from(data);
		noRiff.write("RIFX", 0x38, "latin1");
		expect(readVocLayout(noRiff)).toBeUndefined();
		expect(readVocLayout(Buffer.alloc(0x3c, 0x00))).toBeUndefined();
	});

	it("walks the nibbles of one channel", () => {
		// The walk takes the lower nibble of a byte first and the higher one behind it. The first sample of
		// the sound stands in the head, and every step moves the sample behind the one it read.
		const data = vocFile({
			sampleCount: 6,
			channels: 1,
			bits: 4,
			previous: [0, 0],
			first: [0x100, 0x200],
			body: Buffer.from([0x01, 0x89, 0x02]),
		});
		const layout = readVocLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeVoc(data, layout).toString("hex")).toBe(
			hex([0, 1, 2, 1, 2, 1, 0, 1, 0, 1, 4, 1]),
		);
	});

	it("walks the nibbles of two channels", () => {
		// Every other step of the walk moves the steps of its own channel along, the two channels standing
		// side by side in the sound.
		const data = vocFile({
			sampleCount: 6,
			channels: 2,
			bits: 4,
			previous: [0, 1],
			first: [0x100, 0x200],
			body: Buffer.from([0x11, 0x00]),
		});
		const layout = readVocLayout(data);
		if (!layout) throw new Error("no layout");
		expect(decodeVoc(data, layout).toString("hex")).toBe(
			hex([0, 1, 2, 1, 5, 1, 5, 1, 5, 1, 0, 0]),
		);
	});

	it("writes a sound out as a wave file", async () => {
		const data = vocFile({
			sampleCount: 6,
			channels: 1,
			bits: 4,
			previous: [0, 0],
			first: [0x100, 0x200],
			body: Buffer.from([0x01, 0x89, 0x02]),
		});
		const out = await extract(data);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(out.subarray(0x24, 0x28).toString("latin1")).toBe("data");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt32LE(0x28)).toBe(12);
		expect(out.subarray(0x2c).toString("hex")).toBe(
			hex([0, 1, 2, 1, 2, 1, 0, 1, 0, 1, 4, 1]),
		);
	});

	it("declines a file that does not hold a sound", async () => {
		const other = vocFile({
			sampleCount: 6,
			channels: 1,
			bits: 4,
			previous: [0, 0],
			first: [0x100, 0x200],
			body: Buffer.from([0x01, 0x89, 0x02]),
		});
		other.write("\x57\x41\x56\x82", 0, "latin1");
		await expect(
			aypioVocAudioFormat.open(new BufferByteSource(other), "sound.voc"),
		).rejects.toThrow(GarbroError);
		await expect(
			aypioVocAudioFormat.open(new BufferByteSource(other), "sound.voc"),
		).rejects.toThrow("Not a UK2 engine sound");
	});

	it("stops where the walk runs out of the file", () => {
		const data = vocFile({
			sampleCount: 6,
			channels: 1,
			bits: 4,
			previous: [0, 0],
			first: [0x100, 0x200],
			body: Buffer.from([0x01]),
		});
		const layout = readVocLayout(data);
		if (!layout) throw new Error("no layout");
		expect(() => decodeVoc(data, layout)).toThrow(
			"UK2 sound is cut short of its walk",
		);
	});
});

/** The bytes of a sound, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
