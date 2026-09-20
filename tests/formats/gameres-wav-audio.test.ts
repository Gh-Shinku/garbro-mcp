import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	findWavDataChunk,
	gameresWavAudioDescriptor,
	gameresWavAudioFormat,
	readWavEmbedded,
	readWavLayout,
} from "../../packages/formats/src/gameres/wav-audio.js";

/** A wave of the RIFF kind: the head, the chunks behind it and the places of the sound. */
function wavFile(input: {
	tag?: number;
	channels?: number;
	sampleRate?: number;
	bitsPerSample?: number;
	chunks?: { word: string; body: Buffer }[];
	data?: Buffer;
	word?: string;
}): Buffer {
	const format = Buffer.alloc(0x10, 0x00);
	format.writeUInt16LE(input.tag ?? 1, 0);
	format.writeUInt16LE(input.channels ?? 2, 2);
	format.writeUInt32LE(input.sampleRate ?? 44100, 4);
	format.writeUInt32LE(176400, 8);
	format.writeUInt16LE(4, 12);
	format.writeUInt16LE(input.bitsPerSample ?? 16, 14);
	const chunks: Buffer[] = [
		Buffer.from("fmt ", "latin1"),
		chunkLength(format.length),
		format,
	];
	for (const chunk of input.chunks ?? []) {
		chunks.push(Buffer.from(chunk.word, "latin1"));
		chunks.push(chunkLength(chunk.body.length));
		chunks.push(chunk.body);
		if (0 !== (chunk.body.length & 1)) chunks.push(Buffer.alloc(1, 0x00));
	}
	const data = input.data ?? Buffer.from([0x01, 0x02, 0x03, 0x04]);
	chunks.push(Buffer.from("data", "latin1"));
	chunks.push(chunkLength(data.length));
	chunks.push(data);
	const body = Buffer.concat(chunks);
	const head = Buffer.alloc(0x0c, 0x00);
	head.write(input.word ?? "RIFF", 0, "latin1");
	head.writeUInt32LE(body.length + 4, 4);
	head.write("WAVE", 8, "latin1");
	return Buffer.concat([head, body]);
}

function chunkLength(size: number): Buffer {
	const out = Buffer.alloc(4, 0x00);
	out.writeUInt32LE(size, 0);
	return out;
}

/** A sound of the Ogg kind, and the places of an MPEG Layer 3 sound. */
const OGG = Buffer.concat([
	Buffer.from("OggS", "latin1"),
	Buffer.alloc(0x20, 0x5a),
]);
const MP3 = Buffer.concat([
	Buffer.from([0xff, 0xfb, 0x90, 0x00]),
	Buffer.alloc(0x20, 0x7e),
]);

describe("Wave audio format", () => {
	it("reads the head of a wave", () => {
		expect(readWavLayout(wavFile({}))).toEqual({
			formatTag: 1,
			channels: 2,
			sampleRate: 44100,
			averageBytesPerSecond: 176400,
			blockAlign: 4,
			bitsPerSample: 16,
		});
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(readWavLayout(Buffer.alloc(0x20))).toBeUndefined();
		expect(readWavLayout(wavFile({ word: "RIFX" }))).toBeUndefined();
		expect(readWavLayout(Buffer.alloc(8))).toBeUndefined();
	});

	it("turns away a wave whose places stand as a sound of their own", () => {
		expect(readWavLayout(wavFile({ tag: 0xffff }))).toBeUndefined();
		expect(readWavLayout(wavFile({ tag: 0x674f }))).toBeUndefined();
		expect(readWavLayout(wavFile({ tag: 0x676f }))).toBeUndefined();
		expect(readWavLayout(wavFile({ tag: 0x6770 }))).toBeUndefined();
	});

	it("turns away a wave of no places of a colour", () => {
		expect(readWavLayout(wavFile({ channels: 0 }))).toBeUndefined();
		expect(readWavLayout(wavFile({ tag: 0 }))).toBeUndefined();
	});

	it("finds the chunk the places of the sound stand in", () => {
		const data = Buffer.alloc(0x40, 0x33);
		const file = wavFile({
			chunks: [
				{ word: "LIST", body: Buffer.alloc(0x0a, 0x2a) },
				{ word: "fact", body: Buffer.alloc(0x05, 0x11) },
			],
			data,
		});
		const chunk = findWavDataChunk(file, file.length);
		expect(chunk?.size).toBe(0x40);
		expect(file.subarray(chunk?.offset ?? 0, (chunk?.offset ?? 0) + 4)).toEqual(
			data.subarray(0, 4),
		);
	});

	it("reads the places of a sound that stand as a sound of the Ogg kind", () => {
		const file = wavFile({ tag: 0x6771, data: OGG });
		const layout = readWavLayout(file);
		if (!layout) throw new Error("the wave stands in the file");
		const chunk = findWavDataChunk(file, file.length);
		expect(readWavEmbedded(file, layout, chunk)).toBe("ogg");
	});

	it("reads the places of a sound that stand as the places of an MPEG Layer 3 sound", () => {
		const file = wavFile({ tag: 0x0055, data: MP3 });
		const layout = readWavLayout(file);
		if (!layout) throw new Error("the wave stands in the file");
		const chunk = findWavDataChunk(file, file.length);
		expect(readWavEmbedded(file, layout, chunk)).toBe("mp3");
	});

	it("leaves the places of a sound of another kind to the wave itself", () => {
		const file = wavFile({ tag: 1, data: OGG });
		const layout = readWavLayout(file);
		if (!layout) throw new Error("the wave stands in the file");
		const chunk = findWavDataChunk(file, file.length);
		expect(readWavEmbedded(file, layout, chunk)).toBeUndefined();
		const plain = wavFile({ tag: 0x6771, data: Buffer.alloc(8, 0x00) });
		const plainLayout = readWavLayout(plain);
		if (!plainLayout) throw new Error("the wave stands in the file");
		expect(
			readWavEmbedded(
				plain,
				plainLayout,
				findWavDataChunk(plain, plain.length),
			),
		).toBeUndefined();
	});

	it("hands out the places of a sound as they stand", async () => {
		const file = wavFile({});
		const handle = await gameresWavAudioFormat.open(
			new BufferByteSource(file),
			"sound.wav",
		);
		expect(handle.entries[0]?.path).toBe("sound.wav");
		expect(handle.entries[0]?.metadata).toMatchObject({ type: "audio" });
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 16,
		});
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body).toEqual(file);
	});

	it("hands out a sound that stands as a sound of its own", async () => {
		const handle = await gameresWavAudioFormat.open(
			new BufferByteSource(wavFile({ tag: 0x6771, data: OGG })),
			"sound.wav",
		);
		expect(handle.entries[0]?.path).toBe("sound.ogg");
		expect(handle.metadata).toMatchObject({ audio: "ogg" });
		const body = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		expect(body).toEqual(OGG);
	});

	it("finds a wave of its own kind", async () => {
		expect(gameresWavAudioDescriptor.id).toBe("gameres-wav-audio");
		await expect(
			gameresWavAudioFormat.detect(new BufferByteSource(wavFile({}))),
		).resolves.toBe(true);
		await expect(
			gameresWavAudioFormat.detect(
				new BufferByteSource(Buffer.from("not a wave at all")),
			),
		).resolves.toBe(false);
	});
});
