import { BufferByteSource } from "@garbro-mcp/core";
import { cmbAudioDescriptor, cmbAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const RIFF_HEADER_SIZE = 44;
const DATA_BASE = 8;

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
	sampleRate: 32000,
	averageBytesPerSecond: 64000,
	blockAlign: 6,
	bitsPerSample: 8,
};

interface Built {
	file: Buffer;
	pcm: Buffer;
	format: Format;
	dataOffset: number;
}

/** Two leading lengths that account for the whole file, then the wave format and the payload. */
function buildCmb(
	pcmSize = 0x30,
	headerSize = 0x10,
	format: Format = FORMAT,
): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 9) & 0xff;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x5d);
	header.writeInt32LE(pcm.length, 0);
	header.writeInt32LE(headerSize, 4);
	header.writeUInt16LE(format.formatTag, 8);
	header.writeUInt16LE(format.channels, 0xa);
	header.writeUInt32LE(format.sampleRate, 0xc);
	header.writeUInt32LE(format.averageBytesPerSecond, 0x10);
	header.writeUInt16LE(format.blockAlign, 0x14);
	header.writeUInt16LE(format.bitsPerSample, 0x16);
	// Any extra declared header bytes sit between the fixed part and the payload.
	const extra: Buffer = Buffer.alloc(headerSize - 0x10 + DATA_BASE, 0x3c);
	const dataOffset = DATA_BASE + headerSize;
	const before: Buffer = Buffer.concat([header, extra]).subarray(0, dataOffset);
	return { file: Buffer.concat([before, pcm]), pcm, format, dataOffset };
}

/** The RIFF header the port is expected to write around the payload. */
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

describe("pinesoft cmb audio", () => {
	it("has no signature and registers the empty extension", () => {
		expect(cmbAudioFormat.detection?.signatures).toEqual([]);
		expect(cmbAudioDescriptor.extensions).toEqual([""]);
	});

	it("wraps the pcm in a wave header", async () => {
		const built = buildCmb();
		const source = sourceOf(built.file);
		expect(await cmbAudioFormat.detect(source, "BGM01")).toBe(true);
		const archive = await cmbAudioFormat.open(source, "BGM01");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: 2,
				sampleRate: 32000,
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
			expect(output.readUInt32LE(28)).toBe(64000);
		} finally {
			await archive.close();
		}
	});

	it("follows the declared header size to the payload", async () => {
		const built = buildCmb(0x20, 0x28);
		expect(built.dataOffset).toBe(0x30);
		const archive = await cmbAudioFormat.open(sourceOf(built.file), "BGM02");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(0x20));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
			// The bytes between the fixed header and the payload are not part of the wave file.
			expect(output.subarray(RIFF_HEADER_SIZE).length).toBe(0x20);
		} finally {
			await archive.close();
		}
	});

	it("accepts a header whose payload is empty", async () => {
		const built = buildCmb(0, 0x10);
		expect(await cmbAudioFormat.detect(sourceOf(built.file), "BGM03")).toBe(
			true,
		);
		const archive = await cmbAudioFormat.open(sourceOf(built.file), "BGM03");
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

	it("declines a file whose lengths do not account for it", async () => {
		const built = buildCmb();
		built.file.writeInt32LE(built.pcm.length - 1, 0);
		expect(await cmbAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a tag whose low byte is not one", async () => {
		const built = buildCmb();
		built.file[8] = 2;
		expect(await cmbAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines more than two channels", async () => {
		const built = buildCmb(0x20, 0x10, { ...FORMAT, channels: 3 });
		expect(await cmbAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a negative data size", async () => {
		const built = buildCmb();
		// Keep the length relation satisfied — header size = length - 7 — while the payload size is negative.
		built.file.writeInt32LE(-1, 0);
		built.file.writeInt32LE(built.file.length - 7, 4);
		expect(-1 + (built.file.length - 7) + 8).toBe(built.file.length);
		expect(await cmbAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await cmbAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01"),
		).toBe(false);
	});
});
