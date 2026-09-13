import { BufferByteSource } from "@garbro-mcp/core";
import { msfAudioDescriptor, msfAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x30;
const RIFF_HEADER_SIZE = 44;
const SIGNATURE = Buffer.from("MSF ", "ascii");

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
	key: number;
}

/**
 * Builds the scrambled header. The reference derives the key from the **stored** word at offset 4 and
 * descrambles the whole header in place, but the four signature bytes are the stored ones — it checks
 * them before descrambling and never again — so only the field area is scrambled here.
 */
function buildMsf(
	pcmSize = 0x24,
	storedKeyWord = 0x1234,
	format: Format = FORMAT,
	extra = 0,
	declared = pcmSize,
): Built {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 11) & 0xff;
	const key = (101 * storedKeyWord + 778) & 0xffff;
	// The descrambled fields start at 0x18 and every one of them is two byte aligned.
	const fields: Buffer = Buffer.alloc(0x18, 0x00);
	fields.writeUInt32LE(declared, 0x00);
	fields.writeUInt16LE(format.formatTag, 0x04);
	fields.writeUInt16LE(format.channels, 0x06);
	fields.writeUInt32LE(format.sampleRate, 0x08);
	fields.writeUInt32LE(format.averageBytesPerSecond, 0x0c);
	fields.writeUInt16LE(format.blockAlign, 0x10);
	fields.writeUInt16LE(format.bitsPerSample, 0x12);
	const stored: Buffer = Buffer.alloc(HEADER_SIZE, 0x5c);
	SIGNATURE.copy(stored, 0);
	for (let i = 0; i < fields.length; i += 2) {
		stored[0x18 + i] = (fields[i] as number) ^ (key & 0xff);
		stored[0x19 + i] = (fields[i + 1] as number) ^ ((key >> 8) & 0xff);
	}
	// The key word is part of the stored header, so it is written after the scrambling.
	stored.writeUInt16LE(storedKeyWord, 4);
	return {
		file: Buffer.concat([stored, pcm, Buffer.alloc(extra, 0x77)]),
		pcm,
		format,
		key,
	};
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

describe("unknown msf audio", () => {
	it("declares the MSF signature and no extension", () => {
		expect(msfAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(msfAudioDescriptor.extensions).toEqual([]);
	});

	it("descrambles the header and wraps the pcm verbatim", async () => {
		const built = buildMsf();
		const source = sourceOf(built.file);
		expect(await msfAudioFormat.detect(source, "BGM01.MSF")).toBe(true);
		const archive = await msfAudioFormat.open(source, "BGM01.MSF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				scrambledHeader: true,
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

	it("derives the key from the stored word", async () => {
		// A different stored word means a different key, so the same plaintext scrambles differently.
		const first = buildMsf(0x10, 0x1234);
		const second = buildMsf(0x10, 0x5678);
		expect(first.key).not.toBe(second.key);
		expect(first.key).toBe((101 * 0x1234 + 778) & 0xffff);
		// The signature is stored in the clear, while the field area really is scrambled.
		expect(first.file.subarray(0, 4)).toEqual(SIGNATURE);
		expect(first.file.readUInt32LE(0x18)).not.toBe(0x24);
		for (const built of [first, second]) {
			const archive = await msfAudioFormat.open(
				sourceOf(built.file),
				"BGM02.MSF",
			);
			try {
				expect(archive.metadata).toMatchObject({
					channels: 2,
					sampleRate: 22050,
				});
				const entry = archive.entries[0];
				if (!entry) throw new Error("missing entry");
				const output = await consumeBuffer(await archive.openEntry(entry.id));
				expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
			} finally {
				await archive.close();
			}
		}
	});

	it("reads only the declared number of pcm bytes", async () => {
		const built = buildMsf(0x20, 0x1234, FORMAT, 0x30);
		const archive = await msfAudioFormat.open(
			sourceOf(built.file),
			"BGM03.MSF",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x20);
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
		} finally {
			await archive.close();
		}
	});

	it("clamps a declared size that runs past the end of the file", async () => {
		// The header declares 0x80 bytes but only 0x20 follow, which GARbro's region clamps.
		const built = buildMsf(0x20, 0x1234, FORMAT, 0, 0x80);
		expect(built.pcm.length).toBe(0x20);
		const archive = await msfAudioFormat.open(
			sourceOf(built.file),
			"BGM04.MSF",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(0x20));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x20);
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(built.pcm);
		} finally {
			await archive.close();
		}
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await msfAudioFormat.detect(
				sourceOf(Buffer.concat([SIGNATURE, Buffer.alloc(8)])),
				"BGM01.MSF",
			),
		).toBe(false);
	});

	it("declines a different signature", async () => {
		const built = buildMsf();
		built.file[3] = 0x00;
		expect(await msfAudioFormat.detect(sourceOf(built.file), "BGM01.MSF")).toBe(
			false,
		);
	});
});
