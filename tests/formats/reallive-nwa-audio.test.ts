import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	readNwaLayout,
	readNwaWave,
	realliveNwaAudioFormat,
	unpackNwaPcm,
} from "../../packages/formats/src/reallive/nwa-audio.js";

const HEAD_SIZE = 0x28;
const DATA_OFFSET = 0x2c;
const PLACES_PER_WORD = 8;

function packLsb(bits: number[]): Buffer {
	const out = Buffer.alloc(Math.ceil(bits.length / PLACES_PER_WORD));
	for (let at = 0; at < bits.length; at += 1) {
		if ((bits[at] ?? 0) !== 0) {
			const byte = at >> 3;
			out[byte] = ((out[byte] ?? 0) | (1 << (at % 8))) & 0xff;
		}
	}
	return out;
}

function valueBits(value: number, count: number): number[] {
	const out: number[] = [];
	for (let i = 0; i < count; i += 1) out.push((value >> i) & 1);
	return out;
}

function head(options: {
	channels: number;
	bps: number;
	compression: number;
	blockCount: number;
	pcmSize: number;
	sampleCount: number;
	blockSize: number;
	finalBlockSize?: number;
	rle?: number;
	rate?: number;
}): Buffer {
	const out = Buffer.alloc(HEAD_SIZE, 0x00);
	out.writeUInt16LE(options.channels, 0);
	out.writeUInt16LE(options.bps, 2);
	out.writeUInt32LE(options.rate ?? 8000, 4);
	out.writeInt32LE(options.compression, 8);
	out.writeInt32LE(options.rle ?? 0, 0xc);
	out.writeInt32LE(options.blockCount, 0x10);
	out.writeInt32LE(options.pcmSize, 0x14);
	out.writeInt32LE(options.pcmSize, 0x18);
	out.writeInt32LE(options.sampleCount, 0x1c);
	out.writeInt32LE(options.blockSize, 0x20);
	out.writeInt32LE(options.finalBlockSize ?? options.blockSize, 0x24);
	return out;
}

function oneBlock(options: {
	channels: number;
	bps: number;
	compression: number;
	blockSize: number;
	initial: Buffer;
	bits: number[];
	finalBlockSize?: number;
	rle?: number;
}): Buffer {
	const block = Buffer.concat([options.initial, packLsb(options.bits)]);
	const pcmSize = Math.floor(
		(options.blockSize * options.bps) / PLACES_PER_WORD,
	);
	const sampleCount = Math.floor((pcmSize * PLACES_PER_WORD) / options.bps);
	const offsets = Buffer.alloc(4);
	offsets.writeUInt32LE(DATA_OFFSET + 4, 0);
	return Buffer.concat([
		head({
			channels: options.channels,
			bps: options.bps,
			compression: options.compression,
			blockCount: 1,
			pcmSize,
			sampleCount,
			blockSize: options.blockSize,
			finalBlockSize: options.finalBlockSize ?? options.blockSize,
			rle: options.rle ?? 0,
		}),
		Buffer.alloc(4),
		offsets,
		block,
	]);
}

describe("RealLive engine audio format", () => {
	it("reads the words of the head of a sound", () => {
		const file = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 5,
			initial: Buffer.from([0x10]),
			bits: [],
		});
		expect(readNwaLayout(file, file.length)).toEqual({
			channels: 1,
			bitsPerSample: 8,
			samplesPerSecond: 8000,
			compression: 0,
			runLengthEncoded: false,
			blockCount: 1,
			pcmSize: 5,
			packedSize: 5,
			sampleCount: 5,
			blockSize: 5,
			finalBlockSize: 5,
		});
	});

	it("turns away the words of the head of a sound of no places of the picture of the walk of them", () => {
		const good = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 5,
			initial: Buffer.from([0x10]),
			bits: [],
		});
		for (const channels of [0, 3]) {
			const bad = Buffer.from(good);
			bad.writeUInt16LE(channels, 0);
			expect(readNwaLayout(bad, bad.length)).toBeUndefined();
		}
		for (const bps of [0, 12, 32]) {
			const bad = Buffer.from(good);
			bad.writeUInt16LE(bps, 2);
			expect(readNwaLayout(bad, bad.length)).toBeUndefined();
		}
		const noSize = Buffer.from(good);
		noSize.writeInt32LE(0, 0x14);
		expect(readNwaLayout(noSize, noSize.length)).toBeUndefined();
		const farKind = Buffer.from(good);
		farKind.writeInt32LE(6, 8);
		expect(readNwaLayout(farKind, farKind.length)).toBeUndefined();
		const wrongCount = Buffer.from(good);
		wrongCount.writeInt32LE(4, 0x1c);
		expect(readNwaLayout(wrongCount, wrongCount.length)).toBeUndefined();
		const raw = head({
			channels: 1,
			bps: 8,
			compression: -1,
			blockCount: 0,
			pcmSize: 3,
			sampleCount: 3,
			blockSize: 3,
		});
		expect(
			readNwaLayout(Buffer.concat([raw, Buffer.alloc(3)]), 0x2c + 3),
		).toBeDefined();
		expect(
			readNwaLayout(Buffer.concat([raw, Buffer.alloc(3)]), 0x2c + 2),
		).toBeUndefined();
		expect(readNwaLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("reads the places of the picture of the walk of the places of the picture of the places of the picture of the walk of them", () => {
		const bits: number[] = [
			...valueBits(1, 3),
			...valueBits(2, 5),
			...valueBits(1, 3),
			...valueBits(0x11, 5),
			...valueBits(7, 3),
			1,
			...valueBits(7, 3),
			0,
			...valueBits(0x81, 8),
			0,
			0,
			0,
			0,
			0,
			0,
			0,
			0,
		];
		const file = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 5,
			initial: Buffer.from([0x10]),
			bits,
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackNwaPcm(file, layout)).toEqual(
			Buffer.from([0x20, 0x18, 0x00, 0x00, 0x00]),
		);
	});

	it("reads the places of the picture of the walk of the places of the picture of the runs of them", () => {
		const bits: number[] = [
			...valueBits(1, 3),
			...valueBits(2, 5),
			...valueBits(0, 3),
			1,
			...valueBits(2, 2),
			...valueBits(1, 3),
			...valueBits(0x11, 5),
			...valueBits(7, 3),
			1,
		];
		const file = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 5,
			initial: Buffer.from([0x10]),
			bits,
			rle: 1,
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackNwaPcm(file, layout)).toEqual(
			Buffer.from([0x20, 0x20, 0x20, 0x20, 0x18]),
		);
	});

	it("reads the places of the picture of the walk of the places of the picture of the sound of sixteen places", () => {
		const bits: number[] = [
			...valueBits(7, 3),
			0,
			...valueBits(1, 8),
			...valueBits(7, 3),
			0,
			...valueBits(0x81, 8),
			...valueBits(7, 3),
			1,
		];
		const file = oneBlock({
			channels: 1,
			bps: 16,
			compression: 0,
			blockSize: 3,
			initial: Buffer.from([0x00, 0x01]),
			bits,
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackNwaPcm(file, layout)).toEqual(
			Buffer.from([0x00, 0x03, 0x00, 0x01, 0x00, 0x00]),
		);
	});

	it("writes reconstructed negative sixteen-bit samples as signed words", () => {
		const file = oneBlock({
			channels: 1,
			bps: 16,
			compression: 0,
			blockSize: 1,
			initial: Buffer.from([0x00, 0x00]),
			bits: [...valueBits(7, 3), 0, ...valueBits(0x81, 8)],
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackNwaPcm(file, layout)).toEqual(Buffer.from([0x00, 0xfe]));
	});

	it("stands the places of the picture of the walk of the places of the picture of the picture of the walk of the places of them beside each other", () => {
		const bits: number[] = [
			...valueBits(7, 3),
			1,
			...valueBits(7, 3),
			1,
			...valueBits(1, 3),
			...valueBits(2, 5),
			...valueBits(1, 3),
			...valueBits(2, 5),
		];
		const file = oneBlock({
			channels: 2,
			bps: 8,
			compression: 0,
			blockSize: 4,
			initial: Buffer.from([0x10, 0x20]),
			bits,
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackNwaPcm(file, layout)).toEqual(
			Buffer.from([0x00, 0x00, 0x10, 0x10]),
		);
	});

	it("reads the places of the picture of the walk of the places of the picture of a sound of the kind of the walk of the places of the picture of their own", () => {
		const file = Buffer.concat([
			head({
				channels: 1,
				bps: 8,
				compression: -1,
				blockCount: 0,
				pcmSize: 3,
				sampleCount: 3,
				blockSize: 3,
			}),
			Buffer.alloc(4),
			Buffer.from([0x11, 0x22, 0x33]),
		]);
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(unpackNwaPcm(file, layout)).toEqual(Buffer.from([0x11, 0x22, 0x33]));
	});

	it("stands the places of the picture of the walk of the places of the picture of a sound out as the places of the picture of the walk of the places of them", async () => {
		const file = oneBlock({
			channels: 1,
			bps: 16,
			compression: 0,
			blockSize: 1,
			initial: Buffer.from([0x00, 0x01]),
			bits: [...valueBits(7, 3), 1],
		});
		const handle = await realliveNwaAudioFormat.open(
			new BufferByteSource(file),
			"sound/theme.nwa",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.path).toBe("theme.wav");
		const wav = await consumeBuffer(await handle.openEntry(entry.id));
		expect(entry.size).toBe(BigInt(wav.length));
		expect(entry.packedSize).toBe(BigInt(file.length));
		expect(entry.compressed).toBe(true);
		expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wav.readUInt16LE(0x16)).toBe(1);
		expect(wav.readUInt32LE(0x18)).toBe(8000);
		expect(wav.readUInt16LE(0x20)).toBe(2);
		expect(wav.readUInt16LE(0x22)).toBe(16);
		expect(wav.subarray(0x2c, 0x2e)).toEqual(Buffer.from([0x00, 0x00]));
	});

	it("reports raw sounds as uncompressed serialized wave entries", async () => {
		const file = Buffer.concat([
			head({
				channels: 1,
				bps: 8,
				compression: -1,
				blockCount: 0,
				pcmSize: 3,
				sampleCount: 3,
				blockSize: 3,
			}),
			Buffer.alloc(4),
			Buffer.from([0x11, 0x22, 0x33]),
		]);
		const handle = await realliveNwaAudioFormat.open(
			new BufferByteSource(file),
			"raw.nwa",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const wav = await consumeBuffer(await handle.openEntry(entry.id));
		expect(entry.size).toBe(47n);
		expect(entry.size).toBe(BigInt(wav.length));
		expect(entry.packedSize).toBe(BigInt(file.length));
		expect(entry.compressed).toBe(false);
		expect(wav.subarray(0x2c)).toEqual(Buffer.from([0x11, 0x22, 0x33]));
	});

	it("accepts structurally valid long sounds above the old eight MiB limit", () => {
		const pcmSize = 12 * 1024 * 1024;
		const file = Buffer.concat([
			head({
				channels: 2,
				bps: 16,
				compression: 5,
				blockCount: 1,
				pcmSize,
				sampleCount: pcmSize / 2,
				blockSize: pcmSize / 2,
			}),
			Buffer.alloc(8),
		]);
		expect(readNwaLayout(file, file.length)?.pcmSize).toBe(pcmSize);
	});

	it("rejects non-increasing block offsets", () => {
		const offsets = Buffer.alloc(8);
		offsets.writeUInt32LE(DATA_OFFSET + offsets.length, 0);
		offsets.writeUInt32LE(DATA_OFFSET + offsets.length, 4);
		const twoBlocks = Buffer.concat([
			head({
				channels: 1,
				bps: 8,
				compression: 0,
				blockCount: 2,
				pcmSize: 2,
				sampleCount: 2,
				blockSize: 1,
			}),
			Buffer.alloc(4),
			offsets,
			Buffer.from([0x10, 0x0f, 0x20, 0x0f]),
		]);
		const layout = readNwaLayout(twoBlocks, twoBlocks.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackNwaPcm(twoBlocks, layout)).toThrow(
			"The NWA block offsets are invalid",
		);
	});

	it("is told by the words of the head of the sound", async () => {
		expect(realliveNwaAudioFormat.descriptor.id).toBe("reallive-nwa-audio");
		const file = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 2,
			initial: Buffer.from([0x10]),
			bits: [...valueBits(7, 3), 1],
		});
		await expect(
			realliveNwaAudioFormat.detect(new BufferByteSource(file)),
		).resolves.toBe(true);
		const wrongChannels = Buffer.from(file);
		wrongChannels.writeUInt16LE(4, 0);
		await expect(
			realliveNwaAudioFormat.detect(new BufferByteSource(wrongChannels)),
		).resolves.toBe(false);
	});

	it("turns a sound of the places of the picture of no places of the walk of them away", async () => {
		const file = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 4,
			initial: Buffer.from([0x10]),
			bits: [],
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackNwaPcm(file, layout)).toThrow(GarbroError);
		await expect(
			realliveNwaAudioFormat.open(
				new BufferByteSource(Buffer.alloc(4)),
				"x.nwa",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});

	it("stands the places of the picture of the walk of the places of the picture of a sound of the walk of them out", () => {
		const file = oneBlock({
			channels: 1,
			bps: 8,
			compression: 0,
			blockSize: 2,
			initial: Buffer.from([0x40]),
			bits: [...valueBits(7, 3), 1, ...valueBits(7, 3), 1],
		});
		const layout = readNwaLayout(file, file.length);
		if (!layout) throw new Error("no layout");
		const wav = readNwaWave(file, layout);
		expect(wav.readUInt32LE(4)).toBe(wav.length - 8);
		expect(wav.readUInt16LE(0x16)).toBe(1);
		expect(wav.readUInt32LE(0x18)).toBe(8000);
		expect(wav.readUInt32LE(0x1c)).toBe(8000);
		expect(wav.readUInt16LE(0x20)).toBe(1);
		expect(wav.readUInt16LE(0x22)).toBe(8);
		expect(wav.subarray(0x2c, 0x2e)).toEqual(Buffer.from([0x00, 0x00]));
	});
});
