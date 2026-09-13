import { BufferByteSource } from "@garbro-mcp/core";
import { sedAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x18;
const RIFF_HEADER_SIZE = 44;

interface Format {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/**
 * A wave format block that is deliberately inconsistent — two channels with a block align of six bytes
 * and one byte per sample — so that the test proves the header is copied verbatim rather than recomputed.
 */
const FORMAT: Format = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 66150,
	blockAlign: 6,
	bitsPerSample: 8,
};

interface Built {
	file: Buffer;
	pcm: Buffer;
	format: Format;
}

function buildSed(pcmSize = 0x28, format: Format = FORMAT): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 5) & 0xff;
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x2a);
	head.write("SE", 0, "latin1");
	head.writeUInt16LE(format.formatTag, 2);
	head.writeUInt16LE(format.channels, 4);
	head.writeUInt32LE(format.sampleRate, 6);
	head.writeUInt32LE(format.averageBytesPerSecond, 10);
	head.writeUInt16LE(format.blockAlign, 14);
	head.writeUInt16LE(format.bitsPerSample, 16);
	head.write("da", 0x12, "latin1");
	head.writeUInt32LE(pcm.length, 0x14);
	return { file: Buffer.concat([head, pcm]), pcm, format };
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

describe("myharvest sed audio", () => {
	it("declares the SE signature for the registry", () => {
		expect(sedAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x53, 0x45, 0x01, 0x00]) },
		]);
	});

	it("wraps the raw pcm in a wave header", async () => {
		const built = buildSed();
		const source = sourceOf(built.file);
		expect(await sedAudioFormat.detect(source, "BGM01.SED")).toBe(true);
		const archive = await sedAudioFormat.open(source, "BGM01.SED");
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
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(
				Buffer.concat([expectedRiff(built.pcm, built.format), built.pcm]),
			);
			// The inconsistent block align survives, so nothing was recomputed.
			expect(output.readUInt16LE(32)).toBe(6);
			expect(output.readUInt16LE(22)).toBe(2);
			expect(output.readUInt32LE(28)).toBe(66150);
		} finally {
			await archive.close();
		}
	});

	it("uses the declared length instead of reading to the end", async () => {
		const built = buildSed(0x10);
		// A trailing region the header does not account for.
		const file = Buffer.concat([built.file, Buffer.alloc(0x20, 0x99)]);
		const archive = await sedAudioFormat.open(sourceOf(file), "BGM02.SED");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x10);
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the marker", async () => {
		const built = buildSed();
		// The marker itself, not a field that happens to look like it.
		built.file.write("xx", 0x12, "latin1");
		expect(await sedAudioFormat.detect(sourceOf(built.file), "BGM01.SED")).toBe(
			false,
		);
	});

	it("declines a file with a different version byte", async () => {
		const built = buildSed();
		built.file[2] = 0x02;
		expect(await sedAudioFormat.detect(sourceOf(built.file), "BGM01.SED")).toBe(
			false,
		);
	});

	it("declines a zero channel count", async () => {
		const built = buildSed();
		built.file.writeUInt16LE(0, 4);
		expect(await sedAudioFormat.detect(sourceOf(built.file), "BGM01.SED")).toBe(
			false,
		);
	});

	it("declines a payload that runs past the end of the file", async () => {
		const built = buildSed(0x10);
		built.file.writeUInt32LE(0x1000, 0x14);
		expect(await sedAudioFormat.detect(sourceOf(built.file), "BGM01.SED")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await sedAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01.SED"),
		).toBe(false);
	});
});
