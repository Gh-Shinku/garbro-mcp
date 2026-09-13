import { BufferByteSource } from "@garbro-mcp/core";
import { harvestBgmAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x1c;
const RIFF_HEADER_SIZE = 44;
const SIGNATURE = Buffer.from("BMG0", "ascii");
const MARKER = Buffer.from([0x64, 0x61, 0x72, 0x00]);

interface Format {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/**
 * Deliberately inconsistent values — two channels with a six byte block align and eight bit samples — so
 * the test proves the header is copied verbatim rather than recomputed.
 */
const FORMAT: Format = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 44100,
	blockAlign: 6,
	bitsPerSample: 8,
};

interface Built {
	file: Buffer;
	pcm: Buffer;
	format: Format;
}

function buildBgm(
	pcmSize = 0x20,
	format: Format = FORMAT,
	declared = pcmSize,
	extra = 0,
): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 13) & 0xff;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x2a);
	SIGNATURE.copy(header, 0);
	header.writeUInt16LE(format.formatTag, 4);
	header.writeUInt16LE(format.channels, 6);
	header.writeUInt32LE(format.sampleRate, 8);
	header.writeUInt32LE(format.averageBytesPerSecond, 0xc);
	header.writeUInt16LE(format.blockAlign, 0x10);
	header.writeUInt16LE(format.bitsPerSample, 0x12);
	MARKER.copy(header, 0x14);
	header.writeUInt32LE(declared, 0x18);
	return {
		file: Buffer.concat([header, pcm, Buffer.alloc(extra, 0x77)]),
		pcm,
		format,
	};
}

function expectedRiff(pcm: Buffer, format: Format): Buffer {
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + pcm.length, 4);
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
	riff.writeUInt32LE(pcm.length, 40);
	return riff;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("myharvest bgm audio", () => {
	it("declares the BMG0 signature and no extension", () => {
		expect(harvestBgmAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("wraps the pcm in a wave header", async () => {
		const built = buildBgm();
		const source = sourceOf(built.file);
		expect(await harvestBgmAudioFormat.detect(source, "BGM01")).toBe(true);
		const archive = await harvestBgmAudioFormat.open(source, "BGM01");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(built.pcm.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(
				Buffer.concat([expectedRiff(built.pcm, built.format), built.pcm]),
			);
			// The inconsistent fields survive, so nothing was recomputed.
			expect(output.readUInt16LE(32)).toBe(6);
			expect(output.readUInt32LE(28)).toBe(44100);
		} finally {
			await archive.close();
		}
	});

	it("reads only the declared number of pcm bytes", async () => {
		const built = buildBgm(0x18, FORMAT, 0x18, 0x20);
		const archive = await harvestBgmAudioFormat.open(
			sourceOf(built.file),
			"BGM02",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x18);
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
		} finally {
			await archive.close();
		}
	});

	it("clamps a declared size that runs past the end of the file", async () => {
		const built = buildBgm(0x10, FORMAT, 0x80);
		const archive = await harvestBgmAudioFormat.open(
			sourceOf(built.file),
			"BGM03",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(0x10));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x10);
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
		} finally {
			await archive.close();
		}
	});

	it("accepts a header whose payload is empty", async () => {
		const built = buildBgm(0);
		expect(
			await harvestBgmAudioFormat.detect(sourceOf(built.file), "BGM04"),
		).toBe(true);
		const archive = await harvestBgmAudioFormat.open(
			sourceOf(built.file),
			"BGM04",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE);
			expect(output.readUInt32LE(40)).toBe(0);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose marker is missing", async () => {
		const built = buildBgm();
		// Clobber the marker's first byte, not a format field.
		built.file[0x14] = 0x65;
		expect(
			await harvestBgmAudioFormat.detect(sourceOf(built.file), "BGM01"),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const built = buildBgm();
		built.file[3] = 0x31;
		expect(
			await harvestBgmAudioFormat.detect(sourceOf(built.file), "BGM01"),
		).toBe(false);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await harvestBgmAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01"),
		).toBe(false);
	});
});
