import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	type Fsb5Layout,
	readFsb5Layout,
	readFsb5Wave,
	unityFsb5AudioFormat,
	unpackFsb5Pcm,
} from "../../packages/formats/src/unity/fsb5-audio.js";

const HEAD_SIZE = 0x3c;
const PCM8 = 1;
const PCM16 = 2;
const PCM24 = 3;
const PCM32 = 4;
const PCM_FLOAT = 5;
const VORBIS = 15;

/** The places of the picture of the walk of the places of the picture of a sound of this kind, standing of no
 * places of the picture of the walk of the places of the picture where the places of the picture of the walk
 * of the places of the picture of the head of the picture of the walk of them stand of no places of the
 * picture of the walk of them of their own. */
function mustLayout(file: Buffer): Fsb5Layout {
	const layout = readFsb5Layout(file, file.length);
	if (!layout) throw new Error("no layout");
	return layout;
}

/** The places of the picture of the walk of the places of the picture of a place of the picture of the walk
 * of them: the places of the picture of the walk of them of the places of the picture of the walk of the
 * places of the picture of the word of the walk of the places of the picture of the place of the picture of
 * the walk of them, and of the places of the picture of the walk of the places of the picture of the walk of
 * them. */
function sampleWord(options: {
	nextChunk?: boolean;
	rateIndex?: number;
	channels?: number;
	offsetUnits?: number;
	count?: number;
}): Buffer {
	const raw =
		(options.nextChunk ? 1n : 0n) |
		(BigInt(options.rateIndex ?? 0) << 1n) |
		(BigInt((options.channels ?? 1) - 1) << 5n) |
		(BigInt(options.offsetUnits ?? 0) << 6n) |
		(BigInt(options.count ?? 0) << 34n);
	const out = Buffer.alloc(8);
	out.writeBigInt64LE(raw, 0);
	return out;
}

/** The places of the picture of the walk of the places of the picture of the walk of them of the places of the
 * picture of the walk of the places of the picture of the sound. */
function chunk(kind: number, payload: Buffer, next: boolean): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeInt32LE((next ? 1 : 0) | (payload.length << 1) | (kind << 25), 0);
	return Buffer.concat([out, payload]);
}

function build(options: {
	version?: number;
	format: number;
	table: Buffer;
	nameTable?: Buffer;
	data: Buffer;
	sampleCount: number;
}): Buffer {
	const nameTable = options.nameTable ?? Buffer.alloc(0);
	const head = Buffer.alloc(HEAD_SIZE, 0x00);
	head.write("FSB5", 0, "latin1");
	head.writeInt32LE(options.version ?? 1, 4);
	head.writeInt32LE(options.sampleCount, 8);
	head.writeInt32LE(options.table.length, 0xc);
	head.writeInt32LE(nameTable.length, 0x10);
	head.writeInt32LE(options.data.length, 0x14);
	head.writeInt32LE(options.format, 0x18);
	const extra = options.version === 0 ? Buffer.alloc(4, 0x00) : Buffer.alloc(0);
	return Buffer.concat([head, extra, options.table, nameTable, options.data]);
}

describe("FMOD Sample Bank audio format", () => {
	it("reads the words of the head of a sound and the places of the picture of the walk of the places of their own", () => {
		const data = Buffer.from([
			1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16,
		]);
		const file = build({
			format: PCM16,
			table: sampleWord({ rateIndex: 8, channels: 2, count: 4 }),
			data,
			sampleCount: 1,
		});
		const layout = mustLayout(file);
		expect(layout?.version).toBe(1);
		expect(layout?.format).toBe(PCM16);
		expect(layout?.headerSize).toBe(HEAD_SIZE);
		expect(layout?.dataStart).toBe(HEAD_SIZE + 8);
		expect(layout?.samples).toEqual([
			{ sampleRate: 44100, channels: 2, dataOffset: 0, sampleCount: 4 },
		]);
		const places = unpackFsb5Pcm(file, layout);
		expect(places?.bitsPerSample).toBe(16);
		expect(places?.formatTag).toBe(1);
		expect(places?.pcm).toEqual(data);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the frequency of the places of the picture behind them", () => {
		// The places of the picture of the walk of the places of the picture of the sound of the places of the
		// picture of the walk of them stand of the places of the picture of the walk of the places of the
		// picture of the frequency of the places of the picture behind them that stand beside the places of
		// the picture of the walk of the places of the picture of the sound of their own.
		const rate = Buffer.alloc(4);
		rate.writeInt32LE(12345, 0);
		const table = Buffer.concat([
			sampleWord({ nextChunk: true, rateIndex: 1, count: 2 }),
			chunk(2, rate, false),
		]);
		const file = build({
			format: PCM16,
			table,
			data: Buffer.alloc(4),
			sampleCount: 1,
		});
		const layout = mustLayout(file);
		expect(layout?.samples[0]?.sampleRate).toBe(12345);
	});

	it("stands the places of the picture of the walk of the places of the picture of the walk of them over where they stand of no places of the picture of the walk of the places of the picture of the sound", () => {
		// The places of the picture of the walk of the places of the picture of the walk of them that stand for
		// the places of the picture of the walk of the places of the picture of the sound stand of the places
		// of the picture of the walk of the places of the picture of the sound of the places of the picture of
		// the walk of them of their own.
		const table = Buffer.concat([
			sampleWord({ nextChunk: true, rateIndex: 9, channels: 1, count: 2 }),
			chunk(1, Buffer.from([2]), false),
			sampleWord({ rateIndex: 8, channels: 2, count: 2 }),
		]);
		const file = build({
			format: PCM16,
			table,
			data: Buffer.alloc(12),
			sampleCount: 2,
		});
		const layout = mustLayout(file);
		expect(layout?.samples.length).toBe(2);
		expect(layout?.samples[0]).toEqual({
			sampleRate: 48000,
			channels: 1,
			dataOffset: 0,
			sampleCount: 2,
		});
		expect(layout?.samples[1]).toEqual({
			sampleRate: 44100,
			channels: 2,
			dataOffset: 0,
			sampleCount: 2,
		});
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the kind of the places of the picture of the walk of them of the places of the picture of no places of the picture of their own", () => {
		const data = Buffer.from([1, 2, 3, 4]);
		const file = build({
			version: 0,
			format: PCM8,
			table: Buffer.concat([
				sampleWord({ rateIndex: 3, count: 4 }),
				// The places of the picture of the walk of the places of the picture of the picture of the
				// walk of them stand of the places of the picture of the walk of the places of the picture of
				// the kinds of the walk of the places of the picture of the sound of their own, so the places
				// of the picture of the walk of the places of the picture of the word of the walk of the
				// places of the picture of the sound stand of the places of the picture of the walk of the
				// places of the picture of the picture behind them.
				Buffer.alloc(4, 0x00),
			]),
			data,
			sampleCount: 1,
		});
		const layout = mustLayout(file);
		expect(layout?.version).toBe(0);
		expect(layout?.headerSize).toBe(HEAD_SIZE + 4);
		expect(layout?.dataStart).toBe(HEAD_SIZE + 4 + 12);
		expect(layout?.samples[0]?.sampleRate).toBe(11025);
		const places = unpackFsb5Pcm(file, layout);
		expect(places?.bitsPerSample).toBe(8);
		expect(places?.pcm).toEqual(data);
	});

	it("stands the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the place of the picture of the walk of them out", () => {
		const table = Buffer.concat([
			sampleWord({ rateIndex: 5, count: 8, offsetUnits: 0 }),
			sampleWord({ rateIndex: 5, count: 8, offsetUnits: 1 }),
		]);
		const data = Buffer.from(Array.from({ length: 32 }, (_, i) => i + 1));
		const file = build({
			format: PCM16,
			table,
			data,
			sampleCount: 2,
		});
		const layout = mustLayout(file);
		const places = unpackFsb5Pcm(file, layout);
		expect(places?.pcm.length).toBe(16);
		expect(places?.pcm).toEqual(data.subarray(0, 16));
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of them of the places of the picture of the walk of the places of the picture of the sound of their own", () => {
		const file = build({
			format: PCM_FLOAT,
			table: sampleWord({ rateIndex: 7, channels: 2, count: 2 }),
			data: Buffer.alloc(8, 0x3f),
			sampleCount: 1,
		});
		const layout = mustLayout(file);
		const places = unpackFsb5Pcm(file, layout);
		expect(places?.bitsPerSample).toBe(32);
		expect(places?.formatTag).toBe(3);
		const wave = readFsb5Wave(file, layout);
		expect(wave.readUInt16LE(0x14)).toBe(3);
		expect(wave.readUInt16LE(0x16)).toBe(2);
		expect(wave.readUInt32LE(0x18)).toBe(32000);
		expect(wave.readUInt32LE(0x1c)).toBe(32000 * 8);
		expect(wave.readUInt16LE(0x20)).toBe(8);
		expect(wave.readUInt16LE(0x22)).toBe(32);
		expect(wave.readUInt32LE(0x28)).toBe(8);
	});

	it("turns away the places of the picture of the walk of the places of the picture of a sound of the kinds of the walk of the places of the picture of the engine", () => {
		const good = build({
			format: PCM16,
			table: sampleWord({ rateIndex: 8, count: 2 }),
			data: Buffer.alloc(4),
			sampleCount: 1,
		});
		expect(readFsb5Layout(good, good.length)?.format).toBe(PCM16);
		const wrongMark = Buffer.from(good);
		wrongMark.write("FSB4", 0, "latin1");
		expect(readFsb5Layout(wrongMark, wrongMark.length)).toBeUndefined();
		for (const format of [0, PCM24, 6, 12, 14]) {
			const bad = Buffer.from(good);
			bad.writeInt32LE(format, 0x18);
			expect(readFsb5Layout(bad, bad.length)).toBeUndefined();
		}
		const vorbis = Buffer.from(good);
		vorbis.writeInt32LE(VORBIS, 0x18);
		expect(() => readFsb5Layout(vorbis, vorbis.length)).toThrow(GarbroError);
		const noPlaces = Buffer.from(good);
		noPlaces.writeInt32LE(0, 8);
		expect(readFsb5Layout(noPlaces, noPlaces.length)).toBeUndefined();
		const noRate = build({
			format: PCM16,
			table: sampleWord({ rateIndex: 15, count: 2 }),
			data: Buffer.alloc(4),
			sampleCount: 1,
		});
		expect(() => readFsb5Layout(noRate, noRate.length)).toThrow(GarbroError);
		expect(readFsb5Layout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("stands the places of the picture of the walk of the places of the picture of a sound out as the places of the picture of the walk of the places of the picture of the sound of the kind of the places of the picture of the walk of them", async () => {
		const data = Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]);
		const file = build({
			format: PCM16,
			table: sampleWord({ rateIndex: 8, channels: 2, count: 2 }),
			data,
			sampleCount: 1,
		});
		const handle = await unityFsb5AudioFormat.open(
			new BufferByteSource(file),
			"sound/bank.fsb",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("bank.wav");
		const wave = await consumeBuffer(await handle.openEntry(entry.id));
		expect(wave.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wave.readUInt16LE(0x14)).toBe(1);
		expect(wave.readUInt16LE(0x16)).toBe(2);
		expect(wave.readUInt32LE(0x18)).toBe(44100);
		expect(wave.subarray(0x2c)).toEqual(data);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the picture of the walk of them", () => {
		const file = build({
			format: PCM32,
			table: sampleWord({ rateIndex: 8, channels: 1, count: 2 }),
			data: Buffer.alloc(8, 0x7f),
			sampleCount: 1,
		});
		const layout = mustLayout(file);
		const places = unpackFsb5Pcm(file, layout);
		expect(places?.bitsPerSample).toBe(32);
		expect(places?.formatTag).toBe(1);
		expect(places?.pcm.length).toBe(8);
	});

	it("is told by the words of the picture of the walk of the places of the picture of the sound", async () => {
		expect(unityFsb5AudioFormat.descriptor.id).toBe("unity-fsb5-audio");
		const file = build({
			format: PCM16,
			table: sampleWord({ rateIndex: 8, count: 2 }),
			data: Buffer.alloc(4),
			sampleCount: 1,
		});
		await expect(
			unityFsb5AudioFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrong = Buffer.from(file);
		wrong.write("FSB4", 0, "latin1");
		await expect(
			unityFsb5AudioFormat.detect(new BufferByteSource(wrong)),
		).resolves.toBe(false);
	});

	it("turns a sound of the places of the picture of no places of the walk of them away", async () => {
		await expect(
			unityFsb5AudioFormat.open(
				new BufferByteSource(Buffer.from("FSB5\0\0\0\0", "latin1")),
				"x.fsb",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
