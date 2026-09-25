// The walk of the places of the file of a Circus sound, against sounds written out of the reference's own
// head and of the plain, packed and Ogg modes it hands over. The stream a packed sound walks is built by
// the mirror of the interleave below, and the samples the walk has to turn out of it were worked out with
// an independent implementation of the same codec (the test tool of the vgmstream project, `xpcm.c`).
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { crc32 } from "@garbro-mcp/codecs";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { circusPcmAudioFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	decodePcmStream,
	interleavePcmFrame,
	pcmCodedValue,
	scalePcmWindow,
	transformPcmFrame,
	unpackPcmLzss,
} from "../../packages/formats/src/circus/pcm-decoder.js";
import { readPcmLayout } from "../../packages/formats/src/circus/pcm-audio.js";
import { readWave } from "../../packages/formats/src/shared/wav.js";

interface PcmFormat {
	formatTag?: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/** `PcmAudio.TryOpen`: the mark, the count of the places, the mode and then the head of the mode. */
function buildPcm(spec: {
	mode: number;
	extra?: number;
	body: Buffer;
	format?: PcmFormat;
	packedSize?: number;
	/** The count of the places of the sound the head declares; a packed sound decodes to its own. */
	sourceSize?: number;
}): Buffer {
	const head = Buffer.alloc(0x20, 0);
	head.write("XPCM", 0, "latin1");
	const extra = spec.extra ?? 0;
	if (5 === spec.mode) {
		head.writeInt32LE(spec.body.length, 4);
		head.writeInt32LE(spec.mode | (extra << 8), 8);
		head.writeUInt32LE(spec.body.length, 0x0c);
		return Buffer.concat([head.subarray(0, 0x10), spec.body]);
	}
	const format = spec.format;
	if (!format) throw new Error("no format");
	head.writeInt32LE(spec.sourceSize ?? spec.body.length, 4);
	head.writeInt32LE(spec.mode | (extra << 8), 8);
	head.writeUInt16LE(format.formatTag ?? 1, 0x0c);
	head.writeUInt16LE(format.channels, 0x0e);
	head.writeUInt32LE(format.sampleRate, 0x10);
	head.writeUInt32LE(format.averageBytesPerSecond, 0x14);
	head.writeUInt16LE(format.blockAlign, 0x18);
	head.writeUInt16LE(format.bitsPerSample, 0x1a);
	if (spec.packedSize !== undefined) {
		head.writeInt32LE(spec.packedSize, 0x1c);
	}
	return Buffer.concat([
		head.subarray(0, spec.packedSize === undefined ? 0x1c : 0x20),
		spec.body,
	]);
}

const FORMAT: PcmFormat = {
	channels: 2,
	sampleRate: 44100,
	averageBytesPerSecond: 176400,
	blockAlign: 4,
	bitsPerSample: 16,
};

async function soundOf(archive: Buffer): Promise<Buffer> {
	const handle = await circusPcmAudioFormat.open(
		new BufferByteSource(archive),
		"sample.pcm",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

async function nameOf(archive: Buffer): Promise<string | undefined> {
	const handle = await circusPcmAudioFormat.open(
		new BufferByteSource(archive),
		"sample.pcm",
	);
	return handle.entries[0]?.path;
}

/**
 * The frame a packed sound carries, built the way the codec reads it: the mirror of `sub_4121C0`'s first
 * two loops, so that the window the walk puts back together is the one the codes ask for.
 */
function frameOfCodes(): {
	window: Buffer;
	frame: Buffer;
	first: number[];
	second: number[];
} {
	const first: number[] = [];
	const second: number[] = [];
	for (let i = 0; i < 2048; i += 1) {
		if (i < 24) {
			first.push(0 === i % 2 ? 1 : 2);
			second.push(0);
		} else if (i < 48) {
			first.push(0);
			second.push(0 === i % 3 ? 1 : 2);
		} else if (i < 72) {
			first.push(0 === i % 5 ? 2 : 1);
			second.push(0);
		} else if (i >= 512 && i < 528) {
			first.push(1);
			second.push(0);
		} else if (i >= 1024 && i < 1032) {
			first.push(0);
			second.push(2);
		} else {
			first.push(0);
			second.push(0);
		}
	}
	const window = Buffer.alloc(0x2000, 0);
	for (let i = 0; i < 2048; i += 1) {
		window.writeUInt16LE(first[i] ?? 0, 4 * i);
		window.writeUInt16LE(second[i] ?? 0, 4 * i + 2);
	}
	const frame = Buffer.alloc(0x2000, 0);
	for (let i = 0; i < 0x1000; i += 1) {
		frame[i] = window[2 * i + 1] ?? 0;
	}
	for (let i = 0; i < 0x800; i += 1) {
		const high =
			((window[4 * i] ?? 0) & 0xf0) | ((window[4 * i + 2] ?? 0) >> 4);
		const low =
			(((window[4 * i] ?? 0) & 0x0f) << 4) | ((window[4 * i + 2] ?? 0) & 0x0f);
		frame[0x1000 + i] = high;
		frame[0x1800 + i] = low;
	}
	return { window, frame, first, second };
}

/** The container of the first packed mode, written with literals alone. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let at = 0; at < data.length; at += 8) {
		const chunk = data.subarray(at, at + 8);
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

/** The samples the independent reading of the codec turns out of the two frames below. */
const ORACLE = {
	frameCrc32: 3977209563,
	windowCrc32: 693830634,
	/** `normalize(transform(scale(interleave(frame))))`, sampled and summed over the whole frame. */
	invHead: [92, 7, 24, 41, -42, -85],
	invSum: 8035,
	pcmCrc32: 2209191061,
	pcmHead: [92, 7, 24, 41, -42, -85, 24, 128, 74, -12, 4, 19],
	overlapStart: [
		58, -14, 3, 28, -55, -117, -19, 99, 70, -8, 9, 30, -53, -104, 0, 110, 65,
		-18, -1, 15, -69, -109, 4, 100, 40, -48, -29, -15, -96, -123, -4, 80,
	],
	pcmTail: [1, 28, -56, -131, -46, 75],
	sampleMin: -131,
	sampleMax: 146,
};

const PCM_SIZE = 2 * 8128;

function samplesOf(wav: Buffer): Buffer {
	const read = readWave(wav);
	if (!read) throw new Error("not a wave");
	return wav.subarray(read.dataOffset, read.dataOffset + read.dataSize);
}

describe("Circus PCM sound", () => {
	it("reads the head of the sound", () => {
		const data = buildPcm({
			mode: 0,
			extra: 2,
			body: Buffer.alloc(8, 0),
			format: FORMAT,
		});
		const layout = readPcmLayout(data);
		expect(layout?.mode).toBe(0);
		expect(layout?.extra).toBe(2);
		expect(layout?.ogg).toBe(false);
		expect(layout?.sourceSize).toBe(8);
		expect(layout?.format?.sampleRate).toBe(44100);
		expect(layout?.format?.channels).toBe(2);
	});

	it("reads a sound of the plain mode", async () => {
		const samples = Buffer.from([1, 0, 2, 0, 3, 0, 4, 0]);
		expect(
			samplesOf(
				await soundOf(buildPcm({ mode: 0, body: samples, format: FORMAT })),
			),
		).toEqual(samples);
		expect(
			await nameOf(buildPcm({ mode: 0, body: samples, format: FORMAT })),
		).toBe("sample.wav");
	});

	it("reads a sound of the fifth mode", async () => {
		const ogg = Buffer.from("OggS and the rest of it", "latin1");
		const sound = await soundOf(buildPcm({ mode: 5, body: ogg }));
		expect(sound).toEqual(ogg);
		expect(await nameOf(buildPcm({ mode: 5, body: ogg }))).toBe("sample.ogg");
	});

	it("names a packed sound by its own mode", async () => {
		const { frame } = frameOfCodes();
		const packed = lzssLiterals(Buffer.concat([frame, frame]));
		const sound = buildPcm({
			mode: 1,
			body: packed,
			format: FORMAT,
			packedSize: packed.length,
		});
		expect(await nameOf(sound)).toBe("sample.wav");
		expect(readPcmLayout(sound)?.mode).toBe(1);
	});

	it("turns the places of a frame into the window they were read out of", () => {
		const { window, frame, first, second } = frameOfCodes();
		expect(crc32(frame) >>> 0).toBe(ORACLE.frameCrc32);
		expect(crc32(window) >>> 0).toBe(ORACLE.windowCrc32);
		const rebuilt = Buffer.alloc(0x2000, 0);
		interleavePcmFrame(frame, 0, rebuilt);
		expect(rebuilt).toEqual(window);
		// The window walk scales every code of it by the scale of its kind.
		const data = new Int32Array(4096);
		const temp = new Int32Array(4096);
		scalePcmWindow(window, 0, data, temp);
		for (let i = 0; i < 72; i += 1) {
			expect(data[i]).toBe(2048 * pcmCodedValue(first[i] ?? 0));
			expect(temp[i]).toBe(2048 * pcmCodedValue(second[i] ?? 0));
		}
		expect(data[2048]).toBe(0);
		expect(temp[4095]).toBe(0);
	});

	it("walks the transform of a frame", () => {
		const { window } = frameOfCodes();
		const data = new Int32Array(4096);
		const temp = new Int32Array(4096);
		scalePcmWindow(window, 0, data, temp);
		transformPcmFrame(data, temp);
		expect([...data.slice(0, 6)]).toEqual(ORACLE.invHead);
		let sum = 0;
		for (const value of data) sum = (sum + value) >>> 0;
		expect(sum).toBe(ORACLE.invSum >>> 0);
	});

	it("walks the whole coded stream of a sound", () => {
		const { frame } = frameOfCodes();
		const stream = Buffer.concat([frame, frame]);
		const pcm = decodePcmStream(stream, PCM_SIZE, 0);
		expect(pcm.length).toBe(PCM_SIZE);
		expect(crc32(pcm) >>> 0).toBe(ORACLE.pcmCrc32);
		const words: number[] = [];
		for (let i = 0; i < 12; i += 1) words.push(pcm.readInt16LE(2 * i));
		expect(words).toEqual(ORACLE.pcmHead);
		const overlap: number[] = [];
		for (let i = 0; i < 32; i += 1)
			overlap.push(pcm.readInt16LE(2 * (4064 + i)));
		expect(overlap).toEqual(ORACLE.overlapStart);
		const tail: number[] = [];
		for (let i = 0; i < 6; i += 1) {
			tail.push(pcm.readInt16LE(PCM_SIZE - 12 + 2 * i));
		}
		expect(tail).toEqual(ORACLE.pcmTail);
		let lowest = 0;
		let highest = 0;
		for (let i = 0; i < PCM_SIZE / 2; i += 1) {
			const value = pcm.readInt16LE(2 * i);
			lowest = Math.min(lowest, value);
			highest = Math.max(highest, value);
		}
		expect(lowest).toBe(ORACLE.sampleMin);
		expect(highest).toBe(ORACLE.sampleMax);
	});

	it("reads a sound of the first packed mode", async () => {
		const { frame } = frameOfCodes();
		const packed = lzssLiterals(Buffer.concat([frame, frame]));
		const sound = buildPcm({
			mode: 1,
			body: packed,
			format: FORMAT,
			packedSize: packed.length,
			sourceSize: PCM_SIZE,
		});
		const wave = await soundOf(sound);
		const samples = samplesOf(wave);
		expect(samples.length).toBe(PCM_SIZE);
		expect(crc32(samples) >>> 0).toBe(ORACLE.pcmCrc32);
	});

	it("reads a sound of the third packed mode", async () => {
		const { frame } = frameOfCodes();
		const packed = deflateSync(Buffer.concat([frame, frame]));
		const sound = buildPcm({
			mode: 3,
			body: packed,
			format: FORMAT,
			packedSize: packed.length,
			sourceSize: PCM_SIZE,
		});
		const samples = samplesOf(await soundOf(sound));
		expect(samples.length).toBe(PCM_SIZE);
		expect(crc32(samples) >>> 0).toBe(ORACLE.pcmCrc32);
	});

	it("reads a packed stream out of its own container", () => {
		const source = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]);
		const packed = lzssLiterals(source);
		const output = Buffer.alloc(source.length, 0);
		unpackPcmLzss(packed, packed.length, output);
		expect(output).toEqual(source);
		// Two places of their own, and then a run of two that reaches back over them.
		const back = Buffer.from([0x03, 0x41, 0x42, 0x82]);
		const out = Buffer.alloc(8, 0);
		unpackPcmLzss(back, back.length, out);
		expect(out.subarray(0, 4)).toEqual(Buffer.from([0x41, 0x42, 0x41, 0x42]));
		expect(out.subarray(4)).toEqual(Buffer.alloc(4, 0));
	});

	it("turns an unknown compression mode away and refuses a cut stream", async () => {
		const { frame } = frameOfCodes();
		const packed = lzssLiterals(frame);
		const cut = buildPcm({
			mode: 1,
			body: packed.subarray(0, 8),
			format: FORMAT,
			packedSize: packed.length,
		});
		await expect(soundOf(cut)).rejects.toThrow(GarbroError);
		const sound = buildPcm({ mode: 5, body: Buffer.from("OggS", "latin1") });
		expect(readPcmLayout(sound)?.ogg).toBe(true);
	});

	it("refuses a sound the reference cannot open", async () => {
		const archive = buildPcm({
			mode: 0,
			body: Buffer.alloc(0),
			format: FORMAT,
		});
		// The head asks for no places at all, which the reference turns away at the mark.
		await expect(
			circusPcmAudioFormat.open(new BufferByteSource(archive), "sample.pcm"),
		).rejects.toThrow(GarbroError);
		// A mode of the engine this port knows nothing of.
		const unknown = buildPcm({
			mode: 2,
			body: Buffer.alloc(4, 0),
			format: FORMAT,
		});
		expect(
			await circusPcmAudioFormat.detect(new BufferByteSource(unknown)),
		).toBe(false);
		expect(
			await circusPcmAudioFormat.detect(
				new BufferByteSource(
					buildPcm({ mode: 0, body: Buffer.alloc(4), format: FORMAT }),
				),
			),
		).toBe(true);
	});

	it("detects a plain sound of any `extra`, but a packed one only of the four kinds", async () => {
		const plain = buildPcm({
			mode: 0,
			extra: 7,
			body: Buffer.alloc(8, 0),
			format: FORMAT,
		});
		expect(await circusPcmAudioFormat.detect(new BufferByteSource(plain))).toBe(
			true,
		);
		const packed = buildPcm({
			mode: 1,
			extra: 7,
			body: Buffer.alloc(8, 0),
			format: FORMAT,
			packedSize: 8,
		});
		expect(
			await circusPcmAudioFormat.detect(new BufferByteSource(packed)),
		).toBe(false);
	});

	it("hands over a sound the file cuts short", async () => {
		const archive = buildPcm({
			mode: 0,
			body: Buffer.from([1, 2, 3, 4]),
			format: FORMAT,
		});
		// The head asks for more places than the file holds.
		archive.writeInt32LE(0x1000, 4);
		const samples = samplesOf(await soundOf(archive));
		expect(samples).toEqual(Buffer.from([1, 2, 3, 4]));
	});
});
