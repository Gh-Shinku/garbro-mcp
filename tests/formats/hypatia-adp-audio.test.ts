import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeAdp,
	hypatiaAdpAudioFormat,
	readAdpLayout,
} from "../../packages/formats/src/hypatia/adp-audio.js";

const HEADER_SIZE = 0x10;
const PCM_OFFSET = 0x2c;

/** A whole file: the header and the nibbles of the stream behind it. */
function adpFile(
	samples: number,
	bytes: number[],
	parts: { sampleRate?: number; channels?: number } = {},
): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write("ADP1", 0, "latin1");
	head.writeInt32LE(samples, 4);
	head.writeUInt32LE(parts.sampleRate ?? 22050, 8);
	head.writeUInt16LE(parts.channels ?? 1, 12);
	return Buffer.concat([head, Buffer.from(bytes)]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "bgm.adp"): Promise<Buffer> {
	const handle = await hypatiaAdpAudioFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The samples of the wave file, in the order the sound keeps them. */
function sampleRun(pcm: Buffer, from = PCM_OFFSET): number[] {
	const out: number[] = [];
	for (let at = from; at + 1 < pcm.length; at += 2) {
		out.push(pcm.readInt16LE(at));
	}
	return out;
}

describe("Hypatia compressed sound format", () => {
	it("finds a sound by its four bytes", async () => {
		const data = adpFile(4, [0x00, 0x00]);
		expect(await hypatiaAdpAudioFormat.detect(sourceOf(data), "bgm.adp")).toBe(
			true,
		);
		// The rate has to stand between eight thousand and ninety six thousand, and there may be one or two channels.
		expect(readAdpLayout(adpFile(4, [], { sampleRate: 7999 }))).toBeUndefined();
		expect(
			readAdpLayout(adpFile(4, [], { sampleRate: 96001 })),
		).toBeUndefined();
		expect(readAdpLayout(adpFile(4, [], { sampleRate: 8000 }))).toBeDefined();
		expect(readAdpLayout(adpFile(4, [], { channels: 0 }))).toBeUndefined();
		expect(readAdpLayout(adpFile(4, [], { channels: 3 }))).toBeUndefined();
		expect(readAdpLayout(adpFile(0, []))).toBeUndefined();
		expect(readAdpLayout(adpFile(-1, []))).toBeUndefined();
		expect(readAdpLayout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
	});

	it("reports the format of the sound", async () => {
		const data = adpFile(8, [0, 0], { channels: 2, sampleRate: 44100 });
		const handle = await hypatiaAdpAudioFormat.open(
			sourceOf(data),
			"dir/bgm.adp",
		);
		expect(handle.entries[0]?.path).toBe("bgm.wav");
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			formatTag: 1,
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 16,
		});
		const layout = readAdpLayout(data);
		// The count of the samples stands for one channel, so a sound of two holds twice as many.
		expect(layout?.sampleCount).toBe(16);
		expect(layout?.format.blockAlign).toBe(4);
		expect(layout?.format.averageBytesPerSecond).toBe(44100 * 4);
	});

	it("writes the sound out as a wave file", async () => {
		const wave = await extract(adpFile(4, [0x00, 0x00], { sampleRate: 8000 }));
		expect(wave.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wave.readUInt16LE(0x16)).toBe(1);
		expect(wave.readUInt32LE(0x18)).toBe(8000);
		expect(wave.readUInt16LE(0x20)).toBe(2);
		expect(wave.readUInt32LE(0x28)).toBe(8);
	});

	it("steps the quantiser along the four bits of a sample", async () => {
		// One channel, so both nibbles of a byte stand for samples of the same decoder. The first three nibbles
		// are nothing, so the samples climb by the smallest step; the fourth names the step of six as well, so
		// the sample behind it climbs by eighteen of the first quantiser, which is two hundred and eighty eight.
		const wave = await extract(adpFile(4, [0x00, 0x40]));
		expect(sampleRun(wave)).toEqual([0x20, 0x40, 0x60, 0x180]);
	});

	it("takes a nibble to a channel of a sound of two", async () => {
		// The same two bytes, with a decoder of their own for either channel: the second byte steps the first
		// channel by nothing, while the second channel takes its first step of six. The count of the samples
		// stands for one channel, so the sound holds four frames and the stream runs out after two of them.
		const wave = await extract(adpFile(4, [0x00, 0x40], { channels: 2 }));
		expect(sampleRun(wave)).toEqual([0x20, 0x20, 0x40, 0x140, 0, 0, 0, 0]);
	});

	it("holds the samples inside what sixteen bits carry", async () => {
		// Seven steps of the largest kind walk the quantiser up to the last of its steps, where the samples
		// stand at the largest a signed word holds.
		const wave = await extract(
			adpFile(7, [0x77, 0x77, 0x77, 0x07], { sampleRate: 8000 }),
		);
		expect(sampleRun(wave)).toEqual([
			480, 1500, 3690, 8400, 18510, 32767, 32767,
		]);
	});

	it("leaves the rest of the sound at nothing where the stream runs out", async () => {
		const wave = await extract(adpFile(8, [0x00], { sampleRate: 8000 }));
		const samples = sampleRun(wave);
		expect(samples.slice(0, 2)).toEqual([0x20, 0x40]);
		expect(samples.slice(2).every((value) => 0 === value)).toBe(true);
	});

	it("refuses a sound it cannot hold", async () => {
		const data = adpFile(0x10000000, []);
		expect(await hypatiaAdpAudioFormat.detect(sourceOf(data), "bgm.adp")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("reads the nibbles of a sound on its own", () => {
		// The low nibble first: seven steps of the smallest kind, which walks the quantiser up to its ninth
		// step, where the nibble of four draws eighteen of thirty four on top of the sample behind it.
		const data = adpFile(2, [0x47]);
		const layout = readAdpLayout(data);
		if (!layout) throw new Error("no layout");
		const pcm = decodeAdp(data, layout);
		expect(pcm.length).toBe(4);
		expect(sampleRun(pcm, 0)).toEqual([480, 1092]);
	});
});
