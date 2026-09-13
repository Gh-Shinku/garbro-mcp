import { BufferByteSource } from "@garbro-mcp/core";
import { nsfAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x10;
const RIFF_HEADER_SIZE = 44;

interface Format {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/** Defaults whose average byte rate matches what the format fields imply. */
const FORMAT: Format = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 44100,
	blockAlign: 2,
	bitsPerSample: 8,
};

interface Built {
	file: Buffer;
	pcm: Buffer;
	format: Format;
}

function buildNsf(pcmSize = 0x20, format: Format = FORMAT): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 17) & 0xff;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x2a);
	header.writeUInt16LE(format.formatTag, 0);
	header.writeUInt16LE(format.channels, 2);
	header.writeUInt32LE(format.sampleRate, 4);
	// The average byte rate is a sixteen bit field; bytes 0xA and 0xB are filler.
	header.writeUInt16LE(format.averageBytesPerSecond, 8);
	header.writeUInt16LE(format.blockAlign, 0xc);
	header.writeUInt16LE(format.bitsPerSample, 0xe);
	return {
		file: Buffer.concat([header, pcm]),
		pcm,
		format,
	};
}

function expectedRiff(built: Built): Buffer {
	const format = built.format;
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + built.pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	riff.writeUInt16LE(format.formatTag, 20);
	riff.writeUInt16LE(format.channels, 22);
	riff.writeUInt32LE(format.sampleRate, 24);
	riff.writeUInt32LE(format.averageBytesPerSecond, 28);
	riff.writeUInt16LE(format.blockAlign, 32);
	riff.writeUInt16LE(format.bitsPerSample, 34);
	riff.write("data", 36, "latin1");
	riff.writeUInt32LE(built.pcm.length, 40);
	return riff;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("pan nsf audio", () => {
	it("registers no signature, since the reference derives its own from the header", () => {
		expect(nsfAudioFormat.detection?.signatures).toEqual([]);
	});

	it("wraps the pcm in a wave header", async () => {
		const built = buildNsf();
		const source = sourceOf(built.file);
		expect(await nsfAudioFormat.detect(source, "BGM01.NSF")).toBe(true);
		const archive = await nsfAudioFormat.open(source, "BGM01.NSF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(built.pcm.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(Buffer.concat([expectedRiff(built), built.pcm]));
			// The average byte rate reaches the wave header as a thirty two bit field.
			expect(output.readUInt32LE(28)).toBe(44100);
		} finally {
			await archive.close();
		}
	});

	it("declines a format block whose average rate disagrees", async () => {
		// 22050 * 2 * 16 / 8 is 88200, which is not what the header claims.
		const built = buildNsf(0x10, {
			...FORMAT,
			bitsPerSample: 16,
			averageBytesPerSecond: 44100,
			blockAlign: 4,
		});
		expect(await nsfAudioFormat.detect(sourceOf(built.file), "BGM01.NSF")).toBe(
			false,
		);
	});

	it("declines a format tag that is not plain pcm", async () => {
		const built = buildNsf(0x10, { ...FORMAT, formatTag: 2 });
		expect(await nsfAudioFormat.detect(sourceOf(built.file), "BGM01.NSF")).toBe(
			false,
		);
	});

	it("declines a file without the NSF extension", async () => {
		const built = buildNsf();
		expect(await nsfAudioFormat.detect(sourceOf(built.file), "BGM01.BIN")).toBe(
			false,
		);
		expect(await nsfAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
		// The extension is compared without regard to case.
		expect(await nsfAudioFormat.detect(sourceOf(built.file), "bgm01.nsf")).toBe(
			true,
		);
	});

	it("accepts a header on its own", async () => {
		const built = buildNsf(0);
		expect(await nsfAudioFormat.detect(sourceOf(built.file), "BGM01.NSF")).toBe(
			true,
		);
		const archive = await nsfAudioFormat.open(
			sourceOf(built.file),
			"BGM01.NSF",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(0n);
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE);
			expect(output.readUInt32LE(40)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await nsfAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01.NSF"),
		).toBe(false);
	});
});
