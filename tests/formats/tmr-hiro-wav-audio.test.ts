import { BufferByteSource } from "@garbro-mcp/core";
import {
	tmrHiroAudioDescriptor,
	tmrHiroAudioFormat,
} from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 9;
const RIFF_HEADER_SIZE = 44;
const CHANNELS = 2;
const SAMPLE_RATE = 44100;
const BLOCK_ALIGN = 4;
const AVERAGE_BYTES_PER_SECOND = SAMPLE_RATE * BLOCK_ALIGN;

interface Built {
	file: Buffer;
	pcm: Buffer;
}

/** Builds a file: the first byte, three free bytes, a zero marker and the declared length. */
function buildTmr(pcmSize = 0x40): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 7) & 0xff;
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x33);
	head.writeUInt8(0x44, 0);
	head.writeUInt8(0, 4);
	head.writeInt32LE(pcm.length, 5);
	return { file: Buffer.concat([head, pcm]), pcm };
}

/** The RIFF header the port is expected to write, from the reference's hard coded format. */
function expectedRiff(pcm: Buffer): Buffer {
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	riff.writeUInt16LE(1, 20);
	riff.writeUInt16LE(CHANNELS, 22);
	riff.writeUInt32LE(SAMPLE_RATE, 24);
	riff.writeUInt32LE(AVERAGE_BYTES_PER_SECOND, 28);
	riff.writeUInt16LE(BLOCK_ALIGN, 32);
	riff.writeUInt16LE(16, 34);
	riff.write("data", 36, "latin1");
	riff.writeUInt32LE(pcm.length, 40);
	return riff;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("tmr-hiro wave audio", () => {
	it("has no signature and registers the empty extension", () => {
		expect(tmrHiroAudioFormat.detection?.signatures).toEqual([]);
		expect(tmrHiroAudioDescriptor.extensions).toEqual([""]);
	});

	it("wraps the pcm in the hard coded wave format", async () => {
		const built = buildTmr();
		const source = sourceOf(built.file);
		expect(await tmrHiroAudioFormat.detect(source, "BGM01")).toBe(true);
		const archive = await tmrHiroAudioFormat.open(source, "BGM01");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: CHANNELS,
				sampleRate: SAMPLE_RATE,
				bitsPerSample: 16,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(
				Buffer.concat([expectedRiff(built.pcm), built.pcm]),
			);
			// The format block is the reference's, not the file's.
			expect(output.readUInt16LE(22)).toBe(CHANNELS);
			expect(output.readUInt32LE(24)).toBe(SAMPLE_RATE);
			expect(output.readUInt32LE(28)).toBe(AVERAGE_BYTES_PER_SECOND);
			expect(output.readUInt16LE(32)).toBe(BLOCK_ALIGN);
			expect(output.readUInt16LE(34)).toBe(16);
		} finally {
			await archive.close();
		}
	});

	it("accepts a header whose payload is empty", async () => {
		const built = buildTmr(0);
		expect(await tmrHiroAudioFormat.detect(sourceOf(built.file), "BGM02")).toBe(
			true,
		);
		const archive = await tmrHiroAudioFormat.open(
			sourceOf(built.file),
			"BGM02",
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

	it("declines a file without the leading 0x44", async () => {
		const built = buildTmr();
		built.file[0] = 0x45;
		expect(await tmrHiroAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a file whose marker byte is not zero", async () => {
		const built = buildTmr();
		built.file[4] = 0x01;
		expect(await tmrHiroAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a length that does not match the file", async () => {
		const built = buildTmr();
		built.file.writeInt32LE(built.pcm.length - 1, 5);
		expect(await tmrHiroAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await tmrHiroAudioFormat.detect(sourceOf(Buffer.alloc(4)), "BGM01"),
		).toBe(false);
	});
});
