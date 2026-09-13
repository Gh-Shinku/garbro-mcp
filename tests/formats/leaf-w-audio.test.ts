import { BufferByteSource } from "@garbro-mcp/core";
import { leafWAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x12;
const RIFF_HEADER_SIZE = 44;

interface Format {
	channels: number;
	blockAlign: number;
	sampleRate: number;
	bitsPerSample: number;
	averageBytesPerSecond: number;
}

/** One channel at 22050 Hz with a one byte block align implies 22050 bytes per second. */
const FORMAT: Format = {
	channels: 1,
	blockAlign: 1,
	sampleRate: 22050,
	bitsPerSample: 8,
	averageBytesPerSecond: 22050,
};

interface Built {
	file: Buffer;
	pcm: Buffer;
	format: Format;
}

function buildW(
	pcmSize = 0x20,
	format: Format = FORMAT,
	options: { lengthDelta?: number; filler?: number } = {},
): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 19) & 0xff;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, options.filler ?? 0x7f);
	header[0] = format.channels;
	header[1] = format.blockAlign;
	header.writeUInt16LE(format.sampleRate, 2);
	header.writeUInt16LE(format.bitsPerSample, 4);
	header.writeUInt32LE(format.averageBytesPerSecond, 6);
	header.writeUInt32LE(pcmSize, 0xa);
	const file = Buffer.concat([header, pcm]);
	if (options.lengthDelta) {
		const extra: Buffer = Buffer.alloc(Math.abs(options.lengthDelta), 0x33);
		return {
			file:
				options.lengthDelta > 0
					? Buffer.concat([file, extra])
					: file.subarray(0, file.length - extra.length),
			pcm,
			format,
		};
	}
	return { file, pcm, format };
}

function expectedRiff(built: Built): Buffer {
	const format = built.format;
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + built.pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	// The file stores no format tag, so this one is hard coded.
	riff.writeUInt16LE(1, 20);
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

describe("leaf w audio", () => {
	it("declares no signature and the w extension", () => {
		expect(leafWAudioFormat.detection?.signatures).toEqual([]);
	});

	it("wraps the pcm in a wave header with a hard coded format tag", async () => {
		const built = buildW();
		const source = sourceOf(built.file);
		expect(await leafWAudioFormat.detect(source, "BGM01.W")).toBe(true);
		const archive = await leafWAudioFormat.open(source, "BGM01.W");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				formatTag: 1,
				channels: 1,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(built.pcm.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(Buffer.concat([expectedRiff(built), built.pcm]));
			expect(output.readUInt16LE(20)).toBe(1);
			// The filler bytes between the fields and the PCM are never inspected.
			expect(output.readUInt32LE(28)).toBe(22050);
		} finally {
			await archive.close();
		}
	});

	it("keeps unusual but consistent fields", async () => {
		// Two channels with a three byte block align at 1000 Hz is odd but satisfies the check.
		const format: Format = {
			channels: 2,
			blockAlign: 3,
			sampleRate: 1000,
			bitsPerSample: 8,
			averageBytesPerSecond: 3000,
		};
		const built = buildW(0x10, format);
		const archive = await leafWAudioFormat.open(
			sourceOf(built.file),
			"BGM02.W",
		);
		try {
			expect(archive.metadata).toMatchObject({ channels: 2, sampleRate: 1000 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(22)).toBe(2);
			expect(output.readUInt16LE(32)).toBe(3);
		} finally {
			await archive.close();
		}
	});

	it("declines a header whose average rate disagrees with the block align", async () => {
		const built = buildW(0x10, { ...FORMAT, averageBytesPerSecond: 44100 });
		expect(await leafWAudioFormat.detect(sourceOf(built.file), "BGM01.W")).toBe(
			false,
		);
	});

	it("declines a length that is not the header plus the pcm", async () => {
		expect(
			await leafWAudioFormat.detect(
				sourceOf(buildW(0x10, FORMAT, { lengthDelta: 1 }).file),
				"BGM01.W",
			),
		).toBe(false);
		expect(
			await leafWAudioFormat.detect(
				sourceOf(buildW(0x10, FORMAT, { lengthDelta: -1 }).file),
				"BGM01.W",
			),
		).toBe(false);
	});

	it("declines the field values the reference rejects", async () => {
		const cases: Format[] = [
			// A channel count above eight.
			{
				...FORMAT,
				channels: 9,
				blockAlign: 9,
				averageBytesPerSecond: 22050 * 9,
			},
			// A bit depth below eight.
			{ ...FORMAT, bitsPerSample: 4 },
			// A zero PCM size makes the file exactly a header, which is rejected.
			{ ...FORMAT, averageBytesPerSecond: 0, sampleRate: 0, blockAlign: 1 },
		];
		for (const format of cases) {
			const pcmSize = format.averageBytesPerSecond === 0 ? 0 : 0x10;
			const built = buildW(pcmSize, format);
			expect(
				await leafWAudioFormat.detect(sourceOf(built.file), "BGM01.W"),
			).toBe(false);
		}
	});

	it("declines a file without the w extension", async () => {
		const built = buildW();
		expect(
			await leafWAudioFormat.detect(sourceOf(built.file), "BGM01.BIN"),
		).toBe(false);
		expect(await leafWAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
		// The extension is compared without regard to case.
		expect(await leafWAudioFormat.detect(sourceOf(built.file), "bgm01.w")).toBe(
			true,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await leafWAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01.W"),
		).toBe(false);
	});
});
