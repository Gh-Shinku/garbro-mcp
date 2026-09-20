import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	criAdxAudioFormat,
	readAdxLayout,
	readAdxWave,
	unpackAdxPcm,
} from "../../packages/formats/src/cri/adx-audio.js";

const SIGNATURE_SIZE = 4;
const HEADER_SIZE = 0x20;
const DATA_OFFSET = SIGNATURE_SIZE + HEADER_SIZE;
const FRAME_SIZE = 0x12;
const SAMPLES_PER_FRAME = 32;

function header(options: {
	channels: number;
	sampleCount: number;
	rate?: number;
	lowestFreq?: number;
	version?: number;
	frameSize?: number;
	frameBits?: number;
	encoding?: number;
	copyright?: string;
	signature?: number;
	headerSize?: number;
}): Buffer {
	const out = Buffer.alloc(DATA_OFFSET, 0x00);
	out.writeUInt16BE(options.headerSize ?? HEADER_SIZE, 0);
	out.writeUInt16BE(options.signature ?? 0x0080, 2);
	out[4] = options.version ?? 3;
	out[5] = options.frameSize ?? FRAME_SIZE;
	out[6] = options.frameBits ?? 4;
	out[7] = options.channels;
	out.writeUInt32BE(options.rate ?? 8000, 8);
	out.writeInt32BE(options.sampleCount, 12);
	out.writeUInt16BE(options.lowestFreq ?? 0, 16);
	out.writeInt16BE(options.encoding ?? 0x0400, 18);
	out.write(options.copyright ?? "(c)CRI", DATA_OFFSET - 6, "latin1");
	return out;
}

function frame(scale: number, nibbles: number[]): Buffer {
	const out = Buffer.alloc(FRAME_SIZE, 0x00);
	out.writeInt16BE(scale, 0);
	for (let at = 0; at < nibbles.length; at += 2) {
		out[2 + (at >> 1)] =
			(((nibbles[at] ?? 0) & 0xf) << 4) | ((nibbles[at + 1] ?? 0) & 0xf);
	}
	return out;
}

function place(places: number[], count = SAMPLES_PER_FRAME): number[] {
	const out = places.slice();
	while (out.length < count) out.push(0);
	return out;
}

describe("CRI MiddleWare ADPCM audio", () => {
	it("reads the words of the head of a sound", () => {
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([1, 2, 3])),
		]);
		const layout = readAdxLayout(file, file.length);
		expect(layout?.channels).toBe(1);
		expect(layout?.samplesPerSecond).toBe(8000);
		expect(layout?.sampleCount).toBe(SAMPLES_PER_FRAME);
		expect(layout?.samplesPerFrame).toBe(SAMPLES_PER_FRAME);
		expect(layout?.frameSize).toBe(FRAME_SIZE);
		expect(layout?.dataOffset).toBe(DATA_OFFSET);
		expect(layout?.scale).toBe(8192);
		expect(layout?.secondScale).toBe(-4096);
	});

	it("turns away the words of the head of a sound of no places of the picture of the walk of them", () => {
		const good = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([1])),
		]);
		const wrongSignature = Buffer.from(good);
		wrongSignature.writeUInt16BE(0x0081, 2);
		expect(
			readAdxLayout(wrongSignature, wrongSignature.length),
		).toBeUndefined();
		const shortHeader = Buffer.from(good);
		shortHeader.writeUInt16BE(8, 0);
		expect(readAdxLayout(shortHeader, shortHeader.length)).toBeUndefined();
		const farHeader = Buffer.from(good);
		farHeader.writeUInt16BE(0xfff0, 0);
		expect(readAdxLayout(farHeader, farHeader.length)).toBeUndefined();
		const wrongCopyright = Buffer.from(good);
		wrongCopyright.write("(c)CRj", DATA_OFFSET - 6, "latin1");
		expect(
			readAdxLayout(wrongCopyright, wrongCopyright.length),
		).toBeUndefined();
		for (const [field, value] of [
			[4, 2],
			[5, 0x10],
			[6, 8],
		] as const) {
			const bad = Buffer.from(good);
			bad[field] = value;
			expect(readAdxLayout(bad, bad.length)).toBeUndefined();
		}
		for (const channels of [0, 17]) {
			const bad = Buffer.from(good);
			bad[7] = channels;
			expect(readAdxLayout(bad, bad.length)).toBeUndefined();
		}
		const wrongEncoding = Buffer.from(good);
		wrongEncoding.writeInt16BE(0x0401, 18);
		expect(readAdxLayout(wrongEncoding, wrongEncoding.length)).toBeUndefined();
		const noSamples = Buffer.from(good);
		noSamples.writeInt32BE(0, 12);
		expect(readAdxLayout(noSamples, noSamples.length)).toBeUndefined();
		expect(readAdxLayout(Buffer.alloc(3), 3)).toBeUndefined();
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound", () => {
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([1, 2, 3])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const pcm = unpackAdxPcm(file, layout);
		const expectPcm = Buffer.alloc(SAMPLES_PER_FRAME * 2);
		for (let i = 0; i < SAMPLES_PER_FRAME; i += 1) {
			const value = i < 3 ? ([1, 4, 10][i] ?? 0) : 16 + 6 * (i - 3);
			expectPcm.writeInt16LE(value, i * 2);
		}
		expect(pcm).toEqual(expectPcm);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of them of their own", () => {
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([8])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const pcm = unpackAdxPcm(file, layout);
		const expectPcm = Buffer.alloc(SAMPLES_PER_FRAME * 2);
		for (let i = 0; i < SAMPLES_PER_FRAME; i += 1)
			expectPcm.writeInt16LE(-8 * (i + 1), i * 2);
		expect(pcm).toEqual(expectPcm);
	});

	it("stands the places of the picture of the walk of the places of the picture of the picture of the walk of the places of them beside each other", () => {
		const file = Buffer.concat([
			header({ channels: 2, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([1, 2, 3])),
			frame(0, place([8])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const pcm = unpackAdxPcm(file, layout);
		const expectPcm = Buffer.alloc(SAMPLES_PER_FRAME * 4);
		for (let i = 0; i < SAMPLES_PER_FRAME; i += 1) {
			const first = i < 3 ? ([1, 4, 10][i] ?? 0) : 16 + 6 * (i - 3);
			expectPcm.writeInt16LE(first, i * 4);
			expectPcm.writeInt16LE(-8 * (i + 1), i * 4 + 2);
		}
		expect(pcm).toEqual(expectPcm);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of more than one place of the picture of the walk of them", () => {
		const count = SAMPLES_PER_FRAME * 2;
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: count }),
			frame(0, place([1, 2, 3])),
			frame(0, place([0])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const pcm = unpackAdxPcm(file, layout);
		const expectPcm = Buffer.alloc(count * 2);
		for (let i = 0; i < count; i += 1) {
			const value = i < 3 ? ([1, 4, 10][i] ?? 0) : 16 + 6 * (i - 3);
			expectPcm.writeInt16LE(value, i * 2);
		}
		expect(pcm).toEqual(expectPcm);
	});

	it("reads the places of the picture of the walk of the places of the picture of the last place of the picture of the sound that stands short", () => {
		const count = SAMPLES_PER_FRAME + 8;
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: count }),
			frame(0, place([1, 2, 3])),
			frame(0, place([0])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const pcm = unpackAdxPcm(file, layout);
		expect(pcm.length).toBe(count * 2);
		expect(pcm.readInt16LE((count - 1) * 2)).toBe(16 + 6 * (count - 4));
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of them of the places of the picture of their own", () => {
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(1, place([1])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const pcm = unpackAdxPcm(file, layout);
		const expectPcm = Buffer.alloc(SAMPLES_PER_FRAME * 2);
		for (let i = 0; i < SAMPLES_PER_FRAME; i += 1)
			expectPcm.writeInt16LE(2 * (i + 1), i * 2);
		expect(pcm).toEqual(expectPcm);
	});

	it("stands the places of the picture of the walk of the places of the picture of a sound out as the places of the picture of a sound of the kind of the walk of the places of them", async () => {
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME, rate: 22050 }),
			frame(0, place([1, 2, 3])),
		]);
		const handle = await criAdxAudioFormat.open(
			new BufferByteSource(file),
			"sound/bgm.adx",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("bgm.wav");
		const wav = await consumeBuffer(await handle.openEntry(entry.id));
		expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wav.readUInt16LE(0x16)).toBe(1);
		expect(wav.readUInt32LE(0x18)).toBe(22050);
		expect(wav.readUInt32LE(0x1c)).toBe(44100);
		expect(wav.readUInt16LE(0x20)).toBe(2);
		expect(wav.readUInt16LE(0x22)).toBe(16);
		expect(wav.readUInt32LE(0x28)).toBe(SAMPLES_PER_FRAME * 2);
		expect(wav.readInt16LE(0x2c)).toBe(1);
	});

	it("is told by the words of the head of the sound", async () => {
		expect(criAdxAudioFormat.descriptor.id).toBe("cri-adx-audio");
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([1])),
		]);
		await expect(
			criAdxAudioFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("(c)CRj", DATA_OFFSET - 6, "latin1");
		await expect(
			criAdxAudioFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
	});

	it("turns a sound of the places of the picture of no places of the walk of them away", async () => {
		const short = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME * 4 }),
			frame(0, place([1])),
		]);
		const layout = readAdxLayout(short, short.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackAdxPcm(short, layout)).toThrow();
		await expect(
			criAdxAudioFormat.open(new BufferByteSource(Buffer.alloc(4)), "x.adx"),
		).rejects.toBeInstanceOf(GarbroError);
	});

	it("stands the places of the picture of the walk of the places of the picture of a sound of the places of the picture of their own out", () => {
		const file = Buffer.concat([
			header({ channels: 1, sampleCount: SAMPLES_PER_FRAME }),
			frame(0, place([1, 2, 3])),
		]);
		const layout = readAdxLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const wav = readAdxWave(file, layout);
		expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
		expect(wav.subarray(0x2c, wav.length).length).toBe(SAMPLES_PER_FRAME * 2);
	});
});
