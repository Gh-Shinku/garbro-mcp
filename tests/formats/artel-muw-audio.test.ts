import { BufferByteSource } from "@garbro-mcp/core";
import { muwAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("RIFF", "ascii");
const FORMAT_TAG = Buffer.from("PCMWFMT ", "latin1");
const RIFF_HEADER_SIZE = 44;

/**
 * Deliberately inconsistent — two channels with a six byte block align and eight bit samples — so the
 * test proves the header is copied rather than recomputed.
 */
const FORMAT = {
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
	dataOffset: number;
}

/**
 * The file is `RIFF`, four bytes, the `PCMWFMT ` tag, the format fields, then the `data` chunk at `0x14`
 * plus the distance stored at `0x10`. The format fields occupy `0x14..0x23`, so the smallest distance is
 * `0x10`; `gap` widens the space before the chunk.
 */
function buildMuw(pcmSize = 0x20, gap = 0, declared = pcmSize): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 11) & 0xff;
	const dataPos = 0x24 + gap;
	const header: Buffer = Buffer.alloc(0x14, 0x00);
	SIGNATURE.copy(header, 0);
	FORMAT_TAG.copy(header, 8);
	header.writeUInt32LE(0x10 + gap, 0x10);
	const fields: Buffer = Buffer.alloc(0x10, 0x00);
	fields.writeUInt16LE(FORMAT.formatTag, 0);
	fields.writeUInt16LE(FORMAT.channels, 2);
	fields.writeUInt32LE(FORMAT.sampleRate, 4);
	fields.writeUInt32LE(FORMAT.averageBytesPerSecond, 8);
	fields.writeUInt16LE(FORMAT.blockAlign, 12);
	fields.writeUInt16LE(FORMAT.bitsPerSample, 14);
	const chunk: Buffer = Buffer.alloc(8, 0x00);
	chunk.writeUInt32LE(0x61746164, 0);
	chunk.writeUInt32LE(declared, 4);
	return {
		file: Buffer.concat([header, fields, Buffer.alloc(gap, 0x40), chunk, pcm]),
		pcm,
		dataOffset: dataPos + 8,
	};
}

function expectedRiff(pcm: Buffer): Buffer {
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	riff.writeUInt16LE(FORMAT.formatTag, 20);
	riff.writeUInt16LE(FORMAT.channels, 22);
	riff.writeUInt32LE(FORMAT.sampleRate, 24);
	riff.writeUInt32LE(FORMAT.averageBytesPerSecond, 28);
	riff.writeUInt16LE(FORMAT.blockAlign, 32);
	riff.writeUInt16LE(FORMAT.bitsPerSample, 34);
	riff.write("data", 36, "latin1");
	riff.writeUInt32LE(pcm.length, 40);
	return riff;
}

/** `ArchiveEntry` carries no offset field, so the port's offset is read through a cast. */
function entryOffset(entry: unknown): number {
	return Number((entry as { offset: bigint }).offset);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("artel muw audio", () => {
	it("declares the RIFF signature and no extension", () => {
		expect(muwAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("wraps the pcm in a wave header", async () => {
		const built = buildMuw();
		const source = sourceOf(built.file);
		expect(await muwAudioFormat.detect(source, "BGM01")).toBe(true);
		const archive = await muwAudioFormat.open(source, "BGM01");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			expect(Number(built.dataOffset)).toBe(0x2c);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(built.pcm.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(
				Buffer.concat([expectedRiff(built.pcm), built.pcm]),
			);
			// The inconsistent fields survive, so nothing was recomputed.
			expect(output.readUInt16LE(32)).toBe(6);
		} finally {
			await archive.close();
		}
	});

	it("follows the stored distance to the data chunk", async () => {
		const built = buildMuw(0x10, 8);
		const archive = await muwAudioFormat.open(sourceOf(built.file), "BGM02");
		try {
			expect(archive.metadata).toMatchObject({ audio: "pcm" });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entryOffset(entry)).toBe(0x34);
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
		} finally {
			await archive.close();
		}
	});

	it("clamps a data size that runs past the end of the file", async () => {
		const built = buildMuw(0x10, 0, 0x80);
		const archive = await muwAudioFormat.open(sourceOf(built.file), "BGM03");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(0x10));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x10);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose chunk tag is not data", async () => {
		const built = buildMuw();
		built.file.writeUInt32LE(0x74616422, built.dataOffset - 8);
		expect(await muwAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a file without the PCMWFMT tag", async () => {
		const built = buildMuw();
		built.file.write("WAVEfmt ", 8, "latin1");
		expect(await muwAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a chunk that starts past the end of the file", async () => {
		const built = buildMuw();
		built.file.writeUInt32LE(0x1000, 0x10);
		expect(await muwAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await muwAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01"),
		).toBe(false);
	});
});
