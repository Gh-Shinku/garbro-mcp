import { BufferByteSource } from "@garbro-mcp/core";
import { iceAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x16;

interface Header {
	tag?: number;
	channels?: number;
	sampleRate?: number;
	averageBytesPerSecond?: number;
	blockAlign?: number;
	bitsPerSample?: number;
	extraSize?: number;
	/** Overrides the announced pcm size, which otherwise matches the payload. */
	pcmSize?: number;
}

function buildIce(pcm: Buffer, header: Header = {}): Buffer {
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	head.writeUInt16LE(header.tag ?? 1, 0);
	head.writeUInt16LE(header.channels ?? 1, 2);
	head.writeUInt32LE(header.sampleRate ?? 22050, 4);
	head.writeUInt32LE(
		header.averageBytesPerSecond ??
			(header.sampleRate ?? 22050) * (header.blockAlign ?? 1),
		8,
	);
	head.writeUInt16LE(header.blockAlign ?? 1, 0xc);
	head.writeUInt16LE(header.bitsPerSample ?? 8, 0xe);
	head.writeUInt16LE(header.extraSize ?? 0, 0x10);
	head.writeUInt32LE(header.pcmSize ?? pcm.length, 0x12);
	return Buffer.concat([head, pcm]);
}

/** A canonical mono eight bit wave, which is what the writer should produce. */
function expectedWave(
	pcm: Buffer,
	format: {
		channels: number;
		sampleRate: number;
		averageBytesPerSecond: number;
		blockAlign: number;
		bitsPerSample: number;
	},
): Buffer {
	const header: Buffer = Buffer.alloc(44, 0x00);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 12, "latin1");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(format.channels, 22);
	header.writeUInt32LE(format.sampleRate, 24);
	header.writeUInt32LE(format.averageBytesPerSecond, 28);
	header.writeUInt16LE(format.blockAlign, 32);
	header.writeUInt16LE(format.bitsPerSample, 34);
	header.write("data", 36, "latin1");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "SOUND"): Promise<Buffer> {
	const archive = await iceAudioFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("ankh ice pcm audio", () => {
	it("registers the two three byte signatures and no extension", () => {
		expect(iceAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x01, 0x00, 0x01]) },
			{ bytes: Buffer.from([0x01, 0x00, 0x02]) },
		]);
		// `Extensions` is a single empty string in the reference, which is its way of saying "any".
		expect(iceAudioFormat.descriptor.extensions).toEqual([]);
	});

	it("wraps a pcm payload in the wave its own header describes", async () => {
		const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		const stored = buildIce(pcm);
		const source = sourceOf(stored);
		// The reference's own signatures name the first two bytes through the format tag and the third
		// through the signature's third byte, which the port re-checks because a direct call skips the
		// registry.
		expect(await iceAudioFormat.detect(source, "SOUND")).toBe(true);
		const archive = await iceAudioFormat.open(source, "SOUND");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SOUND.wav"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				channels: 1,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output).toEqual(
			expectedWave(pcm, {
				channels: 1,
				sampleRate: 22050,
				averageBytesPerSecond: 22050,
				blockAlign: 1,
				bitsPerSample: 8,
			}),
		);
	});

	it("accepts a stereo file, whose second signature byte differs", async () => {
		const pcm = Buffer.from([0x09, 0x0a]);
		const stored = buildIce(pcm, { channels: 2, blockAlign: 2 });
		// The two registered signatures are not versions: their third byte is the low byte of the channel
		// count, so a mono file carries `01 00 01` and a stereo file `01 00 02`.
		expect(stored.subarray(0, 3)).toEqual(Buffer.from([0x01, 0x00, 0x02]));
		expect(await iceAudioFormat.detect(sourceOf(stored), "SOUND")).toBe(true);
		expect(await extract(stored)).toEqual(
			expectedWave(pcm, {
				channels: 2,
				sampleRate: 22050,
				averageBytesPerSecond: 22050 * 2,
				blockAlign: 2,
				bitsPerSample: 8,
			}),
		);
	});

	it("declines a third channel, which moves the signature byte with it", async () => {
		const pcm = Buffer.from([0x09]);
		const stored = buildIce(pcm, { channels: 3, blockAlign: 3 });
		// Three channels makes the signature byte three, which neither registered signature names, and the
		// reference's own channel check rejects it a step later either way.
		expect(stored.subarray(0, 3)).toEqual(Buffer.from([0x01, 0x00, 0x03]));
		expect(await iceAudioFormat.detect(sourceOf(stored), "SOUND")).toBe(false);
	});

	it("declines a size that does not account for the whole file", async () => {
		const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04]);
		// One byte too few and one too many: the reference wants an exact fit either way.
		const short = buildIce(pcm, { pcmSize: 3 });
		expect(await iceAudioFormat.detect(sourceOf(short), "SOUND")).toBe(false);
		const long = buildIce(pcm, { pcmSize: 5 });
		expect(await iceAudioFormat.detect(sourceOf(long), "SOUND")).toBe(false);
		const trailing = Buffer.concat([buildIce(pcm), Buffer.from([0x00])]);
		expect(await iceAudioFormat.detect(sourceOf(trailing), "SOUND")).toBe(
			false,
		);
	});

	it("declines a wrong tag, a stray extra size and a bad channel count", async () => {
		const pcm = Buffer.from([0x01, 0x02]);
		const tag = buildIce(pcm, { tag: 2 });
		expect(await iceAudioFormat.detect(sourceOf(tag), "SOUND")).toBe(false);
		const extra = buildIce(pcm, { extraSize: 1 });
		expect(await iceAudioFormat.detect(sourceOf(extra), "SOUND")).toBe(false);
		const none = buildIce(pcm, { channels: 0 });
		expect(await iceAudioFormat.detect(sourceOf(none), "SOUND")).toBe(false);
		const many = buildIce(pcm, { channels: 3 });
		expect(await iceAudioFormat.detect(sourceOf(many), "SOUND")).toBe(false);
		const two = buildIce(pcm, { channels: 2, blockAlign: 2 });
		expect(await iceAudioFormat.detect(sourceOf(two), "SOUND")).toBe(true);
	});

	it("requires the byte rate to match the samples and block alignment", async () => {
		const pcm = Buffer.from([0x01, 0x02]);
		const wrong = buildIce(pcm, { averageBytesPerSecond: 22051 });
		expect(await iceAudioFormat.detect(sourceOf(wrong), "SOUND")).toBe(false);
		const zero = buildIce(pcm, { averageBytesPerSecond: 0 });
		expect(await iceAudioFormat.detect(sourceOf(zero), "SOUND")).toBe(false);
		const good = buildIce(pcm, {
			sampleRate: 44100,
			averageBytesPerSecond: 44100,
		});
		expect(await iceAudioFormat.detect(sourceOf(good), "SOUND")).toBe(true);
	});

	it("multiplies the byte rate in thirty two bits, as the reference does", async () => {
		// 0x80000000 samples a second with a block alignment of three is 0x180000000, which does not fit a
		// thirty two bit unsigned integer: the reference sees 0x80000000, so a file announcing that byte rate
		// passes a check a wider multiply would fail.
		expect((0x80000000 * 3) >>> 0).toBe(0x80000000);
		const pcm = Buffer.from([0x01, 0x02]);
		const stored = buildIce(pcm, {
			sampleRate: 0x80000000,
			blockAlign: 3,
			averageBytesPerSecond: 0x80000000,
		});
		expect(await iceAudioFormat.detect(sourceOf(stored), "SOUND")).toBe(true);
	});

	it("accepts a header with no pcm at all", async () => {
		const stored = buildIce(Buffer.alloc(0));
		expect(await iceAudioFormat.detect(sourceOf(stored), "SOUND")).toBe(true);
		const output = await extract(stored);
		expect(output).toEqual(
			expectedWave(Buffer.alloc(0), {
				channels: 1,
				sampleRate: 22050,
				averageBytesPerSecond: 22050,
				blockAlign: 1,
				bitsPerSample: 8,
			}),
		);
		expect(output.length).toBe(44);
	});

	it("declines a header that is too short", async () => {
		expect(
			await iceAudioFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"SOUND",
			),
		).toBe(false);
	});
});
