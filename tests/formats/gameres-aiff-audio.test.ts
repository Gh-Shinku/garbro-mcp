// The Audio Interchange File Format port, against sounds built in the test: the chunks of a `FORM`, the
// places of a sound of `COMM` and the places of the samples of `SSND`. The reference hands the walk of that
// format to NAudio and lays out nothing of it itself, so the fixtures stand of the format itself: a sound
// of the places of the samples of the other way of the engine (which the port turns over into a wave file),
// a sound of the places of the samples as they stand (`sowt`), and a sound of a kind of its own (which the
// port refuses).
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import {
	aiffAudioFormat,
	readAiffLayout,
} from "../../packages/formats/src/gameres/aiff-audio.js";
import { describe, expect, it } from "vitest";
import { readWave } from "../../packages/formats/src/shared/wav.js";
import { expectArchive } from "../helpers/archive.js";

/** A chunk of the format: the name of it, the count of its places of the other way of the engine. */
function chunk(id: string, body: Buffer): Buffer {
	const head = Buffer.alloc(8, 0x00);
	Buffer.from(id, "latin1").copy(head, 0);
	head.writeUInt32BE(body.length, 4);
	return Buffer.concat([head, body, Buffer.alloc(body.length & 1, 0x00)]);
}

/**
 * The count of a place of a sample of the format: the places of the count stand of the places of the
 * number of one in front of them, so a whole count of them stands of a place of a sign of nothing and a
 * count of a place of the exponent of it.
 */
function extended80(value: number): Buffer {
	const out = Buffer.alloc(10, 0x00);
	if (0 === value) return out;
	let places = 0;
	let top = BigInt(value);
	while (top >= 2n) {
		top >>= 1n;
		places += 1;
	}
	out.writeUInt16BE(16383 + places, 0);
	out.writeBigUInt64BE(BigInt(value) << BigInt(63 - places), 2);
	return out;
}

/** The places of a sound of the format: the counts of the sound and the count of the places of a sample. */
function comm(input: {
	channels: number;
	frames: number;
	bitsPerSample: number;
	sampleRate: number;
	compression?: string;
}): Buffer {
	const body = Buffer.alloc(input.compression ? 22 : 18, 0x00);
	body.writeUInt16BE(input.channels, 0);
	body.writeUInt32BE(input.frames, 2);
	body.writeUInt16BE(input.bitsPerSample, 6);
	extended80(input.sampleRate).copy(body, 8);
	if (input.compression) {
		Buffer.from(input.compression, "latin1").copy(body, 18);
	}
	return chunk("COMM", body);
}

/** The places of the samples of the format: a place of a count of the places of the walk and the samples. */
function ssnd(samples: Buffer, offset = 0): Buffer {
	const body = Buffer.alloc(8 + samples.length, 0x00);
	body.writeUInt32BE(offset, 0);
	samples.copy(body, 8);
	return chunk("SSND", body);
}

/** A sound of the format, of the kind of the places of the samples of it. */
function aiffFile(input: { form?: string; data: Buffer }): Buffer {
	const body = Buffer.concat([
		input.data,
		Buffer.alloc(input.data.length & 1, 0x00),
	]);
	const head = Buffer.alloc(12, 0x00);
	Buffer.from("FORM", "latin1").copy(head, 0);
	head.writeUInt32BE(4 + body.length, 4);
	Buffer.from(input.form ?? "AIFF", "latin1").copy(head, 8);
	return Buffer.concat([head, body]);
}

/** Two frames of a sound of sixteen places of a sample of the other way of the engine. */
function twoFrames(): Buffer {
	const samples = Buffer.alloc(4, 0x00);
	samples.writeUInt16BE(0x1234, 0);
	samples.writeUInt16BE(0x5678, 2);
	return samples;
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await aiffAudioFormat.open(
		new BufferByteSource(data),
		"sound.aiff",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

describe("Audio Interchange File Format", () => {
	it("reads the places of a sound of the format", () => {
		const samples = twoFrames();
		const data = aiffFile({
			data: Buffer.concat([
				comm({
					channels: 1,
					frames: 2,
					bitsPerSample: 16,
					sampleRate: 44100,
				}),
				ssnd(samples),
			]),
		});
		const layout = readAiffLayout(data);
		if (!layout) throw new Error("no walk of the sound");
		expect(layout.channels).toBe(1);
		expect(layout.frames).toBe(2);
		expect(layout.bitsPerSample).toBe(16);
		expect(layout.sampleRate).toBe(44100);
		expect(layout.compression).toBe("NONE");
		expect(layout.dataSize).toBe(4);
	});

	it("turns a sound of the other way of the engine into a wave of its own", async () => {
		const data = aiffFile({
			data: Buffer.concat([
				comm({
					channels: 1,
					frames: 2,
					bitsPerSample: 16,
					sampleRate: 44100,
				}),
				ssnd(twoFrames()),
			]),
		});
		const source = new BufferByteSource(data);
		expect(await aiffAudioFormat.detect(source, "sound.aiff")).toBe(true);
		const wave = await extract(data);
		const read = readWave(wave);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.format).toMatchObject({
			formatTag: 1,
			channels: 1,
			sampleRate: 44100,
			blockAlign: 2,
			bitsPerSample: 16,
		});
		// The places of the samples of the file stand of the other way of the engine, and the wave of the
		// project stands of the places of the engine: the two words of the sound stand turned over.
		expect([...wave.subarray(read.dataOffset)]).toEqual([
			0x34, 0x12, 0x78, 0x56,
		]);
	});

	it("reads a sound of the places of the samples of the engine as they stand", async () => {
		const samples = Buffer.alloc(4, 0x00);
		samples.writeUInt16LE(0x1234, 0);
		samples.writeUInt16LE(0x5678, 2);
		const data = aiffFile({
			form: "AIFC",
			data: Buffer.concat([
				comm({
					channels: 2,
					frames: 1,
					bitsPerSample: 16,
					sampleRate: 22050,
					compression: "sowt",
				}),
				ssnd(samples),
			]),
		});
		const handle = await aiffAudioFormat.open(
			new BufferByteSource(data),
			"sound.aifc",
		);
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			compression: "pcm",
			channels: 2,
		});
		const wave = await extract(data);
		const read = readWave(wave);
		if (!read) throw new Error("no wave file of the walk");
		expect(read.format.blockAlign).toBe(4);
		expect([...wave.subarray(read.dataOffset)]).toEqual([
			0x34, 0x12, 0x78, 0x56,
		]);
	});

	it("stands of the places of the walk of a sound of a kind of its own", async () => {
		// The places of a sound of the kind `ima4` stand of a walk of their own, which the reference hands
		// over to its reader as well: the file stands of this format, and the places of it stand refused.
		const data = aiffFile({
			form: "AIFC",
			data: Buffer.concat([
				comm({
					channels: 1,
					frames: 2,
					bitsPerSample: 16,
					sampleRate: 22050,
					compression: "ima4",
				}),
				ssnd(Buffer.alloc(4, 0x00)),
			]),
		});
		const source = new BufferByteSource(data);
		expect(await aiffAudioFormat.detect(source, "sound.aifc")).toBe(true);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toMatchObject({
			code: "UNSUPPORTED_FEATURE",
		});
	});

	it("turns away a form of another kind, of no place of a sound, and of no samples", async () => {
		// The reference registers the word `FORM` and nothing else, and hands every one of them to its
		// reader: a form of another kind is not a sound of this format.
		const head = Buffer.alloc(12, 0x00);
		Buffer.from("FORM", "latin1").copy(head, 0);
		Buffer.from("ILBM", "latin1").copy(head, 8);
		await expectArchive({
			format: aiffAudioFormat,
			archive: Buffer.concat([head, chunk("BODY", Buffer.alloc(2, 0x00))]),
			sourcePath: "picture.iff",
			detected: false,
			entries: [],
		});
		await expectArchive({
			format: aiffAudioFormat,
			archive: Buffer.concat([head, Buffer.alloc(4, 0x00)]),
			sourcePath: "short.iff",
			detected: false,
			entries: [],
		});
		// A form of the kind of this format of no places of a sound at all is a sound of this format of no
		// places of it: the mark and the kind of the form stand, and the walk of the places of a sound
		// stands refused.
		const empty = aiffFile({ data: Buffer.alloc(2, 0x00) });
		const source = new BufferByteSource(empty);
		expect(await aiffAudioFormat.detect(source, "sound.aiff")).toBe(true);
		await expect(extract(empty)).rejects.toMatchObject({
			code: "INVALID_ARCHIVE",
		});
	});
});
