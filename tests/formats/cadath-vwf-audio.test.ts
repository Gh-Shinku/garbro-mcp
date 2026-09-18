import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { decryptCgf } from "../../packages/formats/src/cadath/cgf-image.js";
import {
	cadathVwfAudioFormat,
	decodeVwfAdp,
	readVwfLayout,
} from "../../packages/formats/src/cadath/vwf-audio.js";

/** A sound: the head and then the two streams. */
function vwfFile(input: {
	unpackedLength: number;
	sampleRate: number;
	initialSample: number;
	first: Buffer;
	second: Buffer;
	secondScrambled?: boolean;
}): Buffer {
	const head = Buffer.alloc(0x23, 0x00);
	Buffer.from([0x56, 0x57, 0x46, 0x1a]).copy(head, 0);
	head.writeInt32LE(input.unpackedLength, 0x05);
	head.writeUInt32LE(input.sampleRate, 0x0d);
	head.writeInt16LE(input.initialSample, 0x11);
	head.writeInt32LE(input.first.length, 0x13);
	head.writeInt32LE(input.second.length, 0x17);
	const first = Buffer.from(input.first);
	decryptCgf(first, first.length);
	return Buffer.concat([head, first, input.second]);
}

/** A stream: the size of the unwrapped part as a word and then the wrapped part. */
function stream(unwrapped: number, body: Buffer): Buffer {
	const head = Buffer.alloc(4, 0x00);
	head.writeInt32LE(unwrapped, 0);
	return Buffer.concat([head, deflateSync(body)]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await cadathVwfAudioFormat.open(
		new BufferByteSource(data),
		"voice.vwf",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("AZSYSTEM/1.0 audio", () => {
	it("reads the head as the reference does", () => {
		const data = vwfFile({
			unpackedLength: 16,
			sampleRate: 22050,
			initialSample: 0x1000,
			first: stream(1, Buffer.from([0x80])),
			second: stream(4, Buffer.alloc(4, 0x00)),
		});
		expect(readVwfLayout(data)).toMatchObject({
			unpackedLength: 16,
			sampleRate: 22050,
			initialSample: 0x1000,
			firstStreamLength: 13,
			secondStreamLength: 16,
		});
	});

	it("gates on the mark and the sizes", () => {
		const good = vwfFile({
			unpackedLength: 16,
			sampleRate: 22050,
			initialSample: 0,
			first: stream(1, Buffer.from([0x80])),
			second: stream(4, Buffer.alloc(4, 0x00)),
		});
		expect(readVwfLayout(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.writeUInt8(0x57, 3);
		expect(readVwfLayout(mark)).toBeUndefined();
		const length = Buffer.from(good);
		length.writeInt32LE(0, 0x05);
		expect(readVwfLayout(length)).toBeUndefined();
		// The streams have to stand inside the file.
		expect(readVwfLayout(Buffer.from(good.subarray(0, 0x30)))).toBeUndefined();
	});

	it("steps through the nibbles as the reference does", () => {
		// The first nibble of seven is the whole of the quantiser, its half and its quarter, the quantiser
		// being seven at the start and the step a quarter of it, which is nought — so the sample climbs by
		// eleven. The quantiser then stands at eight, which is sixteen, and the second nibble of seven
		// climbs by two and the whole of it, its half and its quarter — thirty.
		const decoded = decodeVwfAdp(Buffer.from([0x77, 0x00]), 3, 0);
		expect(Array.from(decoded)).toEqual([11, 41, 45]);
	});

	it("unwraps the two streams and writes a wave", async () => {
		const out = await extract(
			vwfFile({
				unpackedLength: 16,
				sampleRate: 22050,
				initialSample: 0x1000,
				first: stream(1, Buffer.from([0x80])),
				second: stream(4, Buffer.alloc(4, 0x00)),
			}),
		);
		expect(out.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(out.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(22050);
		expect(out.readUInt16LE(0x20)).toBe(2);
		expect(out.readUInt16LE(0x22)).toBe(16);
		expect(out.readUInt32LE(0x28)).toBe(16);
		// Every nibble is a step of nought, so every sample stands where the walk began, and the first one
		// is turned over by the first place of the first stream.
		const pcm = out.subarray(0x2c);
		expect(pcm.readInt16LE(0)).toBe(-0x1000);
		for (let sample = 1; sample < 8; sample += 1) {
			expect(pcm.readInt16LE(sample * 2)).toBe(0x1000);
		}
	});

	it("declines a file that does not hold a sound", async () => {
		const data = vwfFile({
			unpackedLength: 16,
			sampleRate: 22050,
			initialSample: 0,
			first: stream(1, Buffer.from([0x80])),
			second: stream(4, Buffer.alloc(4, 0x00)),
		});
		data.writeUInt8(0x57, 3);
		await expect(
			cadathVwfAudioFormat.open(new BufferByteSource(data), "voice.vwf"),
		).rejects.toThrow(GarbroError);
		await expect(
			cadathVwfAudioFormat.open(new BufferByteSource(data), "voice.vwf"),
		).rejects.toThrow("Not an AZSYSTEM/1.0 sound");
	});
});
