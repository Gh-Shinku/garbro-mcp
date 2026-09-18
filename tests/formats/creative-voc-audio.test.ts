import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	convertVoc,
	creativeVocAudioFormat,
} from "../../packages/formats/src/creative/voc-audio.js";

/** The head of a Creative Voice File: the mark, the head size and the version. */
function head(): Buffer {
	const bytes = Buffer.alloc(0x1a, 0x00);
	Buffer.from("Creative Voice File\u001a", "latin1").copy(bytes, 0);
	bytes.writeUInt16LE(0x1a, 0x14);
	bytes.writeUInt16LE(0x010a, 0x16);
	return bytes;
}

/** A block: its kind, a size of three bytes and then its own body. */
function block(kind: number, body: Buffer): Buffer {
	const bytes = Buffer.alloc(4 + body.length, 0x00);
	bytes.writeUInt8(kind, 0);
	bytes.writeUInt16LE(body.length & 0xffff, 1);
	bytes.writeUInt8((body.length >> 16) & 0xff, 3);
	body.copy(bytes, 4);
	return bytes;
}

/** A sound of the first kind: one channel of eight bit samples, with its frequency and its codec. */
function soundBlock(frequency: number, codec: number, pcm: Buffer): Buffer {
	return block(1, Buffer.concat([Buffer.from([frequency, codec]), pcm]));
}

/** A sound of the ninth kind, with its rate, its depth, its channels and its codec. */
function soundBlock9(input: {
	rate: number;
	bits: number;
	channels: number;
	codec: number;
	pcm: Buffer;
}): Buffer {
	const own = Buffer.alloc(12, 0x00);
	own.writeUInt32LE(input.rate, 0);
	own.writeUInt8(input.bits, 4);
	own.writeUInt8(input.channels - 1, 5);
	own.writeUInt16LE(input.codec, 6);
	return block(9, Buffer.concat([own, input.pcm]));
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await creativeVocAudioFormat.open(
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

describe("Creative Voice File", () => {
	it("reads the rate of the first kind out of its frequency byte", () => {
		const sound = convertVoc(
			Buffer.concat([
				head(),
				soundBlock(0x80, 0, Buffer.from([0x11, 0x22, 0x33])),
				Buffer.from([0x00]),
			]),
		);
		expect(sound?.format).toEqual({
			formatTag: 1,
			channels: 1,
			// The frequency byte stands under two hundred and fifty six, and the rate is a million over it.
			sampleRate: Math.trunc(1000000 / (256 - 0x80)),
			averageBytesPerSecond: Math.trunc(1000000 / (256 - 0x80)),
			blockAlign: 1,
			bitsPerSample: 8,
		});
		expect(sound?.pcm.toString("hex")).toBe("112233");
	});

	it("gates on the mark, the head size and the samples", () => {
		const good = Buffer.concat([
			head(),
			soundBlock(0x80, 0, Buffer.from([0x11])),
			Buffer.from([0x00]),
		]);
		expect(convertVoc(good)).toBeDefined();
		const mark = Buffer.from(good);
		mark.write("Creative Voice File\u001b", 0, "latin1");
		expect(convertVoc(mark)).toBeUndefined();
		const size = Buffer.from(good);
		size.writeUInt16LE(0x10, 0x14);
		expect(convertVoc(size)).toBeUndefined();
		// A file whose blocks end before a sample does is turned away.
		expect(
			convertVoc(Buffer.concat([head(), Buffer.from([0x00])])),
		).toBeUndefined();
	});

	it("takes the sound of the ninth kind with its own rate and depth", () => {
		const sound = convertVoc(
			Buffer.concat([
				head(),
				soundBlock9({
					rate: 44100,
					bits: 16,
					channels: 2,
					codec: 0,
					pcm: Buffer.from([1, 2, 3, 4]),
				}),
				Buffer.from([0x00]),
			]),
		);
		expect(sound?.format).toMatchObject({
			formatTag: 1,
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 16,
			blockAlign: 4,
			averageBytesPerSecond: 44100 * 4,
		});
		expect(sound?.pcm.toString("hex")).toBe("01020304");
	});

	it("takes the rate of the eighth kind but no samples with it", () => {
		// The reference reads the frequency, the codec and the channel count of this kind and then copies
		// nothing at all: the block's own samples are never read, and the walk goes on with whatever stands
		// behind the four bytes it took. A block of the first kind behind it shows both halves of that.
		const sound = convertVoc(
			Buffer.concat([
				head(),
				// A frequency word of nothing means the whole sixty five thousand five hundred and thirty six
				// steps, and two channels halve the rate the reference works out of it.
				block(8, Buffer.from([0x00, 0x00, 0x00, 0x01])),
				soundBlock(0x80, 0, Buffer.from([0x11])),
				Buffer.from([0x00]),
			]),
		);
		// The last block to name a format is the one that stands, which is the first kind behind it.
		expect(sound?.format).toMatchObject({
			formatTag: 1,
			channels: 1,
			sampleRate: Math.trunc(1000000 / (256 - 0x80)),
			bitsPerSample: 8,
		});
		expect(sound?.pcm.toString("hex")).toBe("11");
	});

	it("adds the sound of a block that continues the one before it", () => {
		const sound = convertVoc(
			Buffer.concat([
				head(),
				soundBlock(0x00, 0, Buffer.from([0x11])),
				block(2, Buffer.from([0x22, 0x33])),
				Buffer.from([0x00]),
			]),
		);
		// A frequency byte of nothing asks for the whole million, and the continuation adds its bytes behind.
		expect(sound?.format.sampleRate).toBe(Math.trunc(1000000 / 256));
		expect(sound?.pcm.toString("hex")).toBe("112233");
	});

	it("hands the sound of the fourth codec out as it stands", () => {
		const sound = convertVoc(
			Buffer.concat([
				head(),
				soundBlock(0x80, 0x07, Buffer.from([0x11, 0x22])),
				Buffer.from([0x00]),
			]),
		);
		expect(sound?.format.formatTag).toBe(7);
		expect(sound?.pcm.toString("hex")).toBe("1122");
	});

	it("passes over a block of a kind it does not know", () => {
		const sound = convertVoc(
			Buffer.concat([
				head(),
				block(0x42, Buffer.from([0x99, 0x98, 0x97])),
				soundBlock(0x80, 0, Buffer.from([0x11])),
				Buffer.from([0x00]),
			]),
		);
		expect(sound?.pcm.toString("hex")).toBe("11");
	});

	it("writes the sound out as a wave", async () => {
		const out = await extract(
			Buffer.concat([
				head(),
				soundBlock(0x80, 0, Buffer.from([0x11, 0x22, 0x33])),
				Buffer.from([0x00]),
			]),
		);
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(Math.trunc(1000000 / 128));
		expect(out.readUInt16LE(0x22)).toBe(8);
		expect(out.readUInt32LE(0x28)).toBe(3);
		expect(out.subarray(0x2c).toString("hex")).toBe("112233");
	});

	it("declines a file that does not hold a sound", async () => {
		const data = Buffer.concat([
			head(),
			soundBlock(0x80, 0, Buffer.from([0x11])),
			Buffer.from([0x00]),
		]);
		data.write("Creative Voice File\u001b", 0, "latin1");
		await expect(
			creativeVocAudioFormat.open(new BufferByteSource(data), "sound.voc"),
		).rejects.toThrow(GarbroError);
		await expect(
			creativeVocAudioFormat.open(new BufferByteSource(data), "sound.voc"),
		).rejects.toThrow("Not a Creative Voice File");
	});
});
