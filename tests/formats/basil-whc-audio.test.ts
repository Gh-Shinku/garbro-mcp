import { BufferByteSource } from "@garbro-mcp/core";
import { whcAudioDescriptor, whcAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x12;
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
 * Deliberately inconsistent values — two channels with a three byte block align and eight bit samples —
 * so the test proves the header is copied verbatim rather than recomputed.
 */
const FORMAT: Format = {
	formatTag: 1,
	channels: 2,
	sampleRate: 11025,
	averageBytesPerSecond: 22050,
	blockAlign: 3,
	bitsPerSample: 8,
};

interface Built {
	file: Buffer;
	pcm: Buffer;
	format: Format;
}

function buildWhc(pcmSize = 0x24, format: Format = FORMAT): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 13) & 0xff;
	const head: Buffer = Buffer.alloc(HEADER_SIZE, 0x2b);
	head.writeUInt16LE(format.formatTag, 0);
	head.writeUInt16LE(format.channels, 2);
	head.writeUInt32LE(format.sampleRate, 4);
	head.writeUInt32LE(format.averageBytesPerSecond, 8);
	head.writeUInt16LE(format.blockAlign, 12);
	head.writeUInt16LE(format.bitsPerSample, 14);
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

describe("basil whc audio", () => {
	it("declares both header signatures and the whc extension", () => {
		expect(whcAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x01, 0x00, 0x02, 0x00]) },
			{ bytes: Buffer.from([0x01, 0x00, 0x01, 0x00]) },
		]);
		expect(whcAudioDescriptor.extensions).toEqual(["whc"]);
	});

	it("wraps the raw pcm in a wave header", async () => {
		const built = buildWhc();
		const source = sourceOf(built.file);
		expect(await whcAudioFormat.detect(source, "BGM01.WHC")).toBe(true);
		const archive = await whcAudioFormat.open(source, "BGM01.WHC");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: 2,
				sampleRate: 11025,
				bitsPerSample: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(
				Buffer.concat([expectedRiff(built.pcm, built.format), built.pcm]),
			);
			// The inconsistent block align survives, so nothing was recomputed.
			expect(output.readUInt16LE(32)).toBe(3);
			expect(output.readUInt32LE(28)).toBe(22050);
		} finally {
			await archive.close();
		}
	});

	it("accepts a one channel file and a lower case name", async () => {
		const mono: Format = { ...FORMAT, channels: 1 };
		const built = buildWhc(0x10, mono);
		expect(await whcAudioFormat.detect(sourceOf(built.file), "bgm.Whc")).toBe(
			true,
		);
		const archive = await whcAudioFormat.open(sourceOf(built.file), "bgm.Whc");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(22)).toBe(1);
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x10);
		} finally {
			await archive.close();
		}
	});

	it("reads to the end of the file, since no length is stored", async () => {
		const built = buildWhc(0x18);
		const archive = await whcAudioFormat.open(
			sourceOf(built.file),
			"BGM03.WHC",
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

	it("declines a file whose name is not whc", async () => {
		const built = buildWhc();
		expect(await whcAudioFormat.detect(sourceOf(built.file), "BGM01.WAV")).toBe(
			false,
		);
	});

	it("declines a format tag that is not pcm", async () => {
		const built = buildWhc(0x10, { ...FORMAT, formatTag: 2 });
		expect(await whcAudioFormat.detect(sourceOf(built.file), "BGM01.WHC")).toBe(
			false,
		);
	});

	it("declines more than two channels", async () => {
		const built = buildWhc(0x10, { ...FORMAT, channels: 3 });
		expect(await whcAudioFormat.detect(sourceOf(built.file), "BGM01.WHC")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await whcAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01.WHC"),
		).toBe(false);
	});
});
