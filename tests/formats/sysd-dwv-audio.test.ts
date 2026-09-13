import { BufferByteSource } from "@garbro-mcp/core";
import { dwvAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("DW", "ascii");
const HEADER_SIZE = 0x1c;
const RIFF_HEADER_SIZE = 44;

interface Built {
	file: Buffer;
	pcm: Buffer;
	bitsPerSample: number;
}

/**
 * The header stores no bit depth. With one channel at 22050 Hz and an average rate of 22050 bytes per
 * second the recovery yields exactly eight bits.
 */
function buildDwv(
	options: {
		pcmSize?: number;
		headerSize?: number;
		channels?: number;
		sampleRate?: number;
		averageBytesPerSecond?: number;
		blockAlign?: number;
		declared?: number;
		fixLength?: boolean;
	} = {},
): Built {
	const pcmSize = options.pcmSize ?? 0x20;
	const channels = options.channels ?? 1;
	const sampleRate = options.sampleRate ?? 22050;
	const averageBytesPerSecond = options.averageBytesPerSecond ?? 22050;
	const blockAlign = options.blockAlign ?? 1;
	const declared = options.declared ?? pcmSize;
	const bitsPerSample = Math.floor(
		(averageBytesPerSecond * 8) / sampleRate / channels,
	);
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 9) & 0xff;
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt16LE(1, 8);
	header.writeUInt16LE(channels, 0xa);
	header.writeUInt32LE(sampleRate, 0xc);
	header.writeUInt32LE(averageBytesPerSecond, 0x10);
	header.writeUInt16LE(blockAlign, 0x14);
	header.writeUInt32LE(declared, 0x18);
	const file = Buffer.concat([header, pcm]);
	// The header repeats the file length; the default keeps that true.
	file.writeUInt32LE(options.fixLength === false ? 0 : file.length, 4);
	return { file, pcm, bitsPerSample };
}

function expectedRiff(built: Built): Buffer {
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + built.pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	riff.writeUInt16LE(1, 20);
	riff.writeUInt16LE(built.file.readUInt16LE(0xa), 22);
	riff.writeUInt32LE(built.file.readUInt32LE(0xc), 24);
	riff.writeUInt32LE(built.file.readUInt32LE(0x10), 28);
	riff.writeUInt16LE(built.file.readUInt16LE(0x14), 32);
	riff.writeUInt16LE(built.bitsPerSample, 34);
	riff.write("data", 36, "latin1");
	riff.writeUInt32LE(built.pcm.length, 40);
	return riff;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("sysd dwv audio", () => {
	it("declares the two byte DW signature", () => {
		expect(dwvAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("derives the bit depth and wraps the pcm", async () => {
		const built = buildDwv();
		const source = sourceOf(built.file);
		expect(await dwvAudioFormat.detect(source, "BGM01")).toBe(true);
		const archive = await dwvAudioFormat.open(source, "BGM01");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				channels: 1,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(built.pcm.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(Buffer.concat([expectedRiff(built), built.pcm]));
			// Nothing in the file states the bit depth; the header's copy was derived.
			expect(output.readUInt16LE(34)).toBe(8);
		} finally {
			await archive.close();
		}
	});

	it("truncates the derived bit depth rather than rounding", async () => {
		// 30000 * 8 / 22050 / 2 is about 5.44, and the reference divides integers.
		const built = buildDwv({
			channels: 2,
			averageBytesPerSecond: 30000,
			blockAlign: 4,
		});
		expect(built.bitsPerSample).toBe(5);
		const archive = await dwvAudioFormat.open(sourceOf(built.file), "BGM02");
		try {
			expect(archive.metadata).toMatchObject({ bitsPerSample: 5 });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(34)).toBe(5);
		} finally {
			await archive.close();
		}
	});

	it("clamps a pcm size that runs past the end of the file", async () => {
		const built = buildDwv({ pcmSize: 0x10, declared: 0x80 });
		const archive = await dwvAudioFormat.open(sourceOf(built.file), "BGM03");
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

	it("declines a file whose header does not repeat its length", async () => {
		const built = buildDwv({ fixLength: false });
		expect(await dwvAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
		// One byte more also breaks the equality.
		const padded = Buffer.concat([buildDwv().file, Buffer.alloc(1)]);
		expect(await dwvAudioFormat.detect(sourceOf(padded), "BGM01")).toBe(false);
	});

	it("declines a header that would divide by zero", async () => {
		expect(
			await dwvAudioFormat.detect(
				sourceOf(buildDwv({ sampleRate: 0 }).file),
				"BGM01",
			),
		).toBe(false);
		expect(
			await dwvAudioFormat.detect(
				sourceOf(buildDwv({ channels: 0 }).file),
				"BGM01",
			),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const built = buildDwv();
		built.file[0] = 0x45;
		expect(await dwvAudioFormat.detect(sourceOf(built.file), "BGM01")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await dwvAudioFormat.detect(sourceOf(Buffer.alloc(8)), "BGM01"),
		).toBe(false);
	});
});
