import { BufferByteSource } from "@garbro-mcp/core";
import { vzyAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PREFIX_SIZE = 0x10;
const PCM_SIZE = 32;

function buildPcm(): Buffer {
	const pcm: Buffer = Buffer.alloc(PCM_SIZE);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 13 + 5) & 0xff;
	return pcm;
}

/** A wave file with a sixteen byte format chunk, an optional trailing chunk, and a data chunk. */
function buildWave(
	options: { trailingChunk?: Buffer; formatLength?: number } = {},
): Buffer {
	const formatLength = options.formatLength ?? 16;
	// The fields need sixteen bytes, but a shorter declared length truncates the body afterwards.
	const formatBody: Buffer = Buffer.alloc(Math.max(formatLength, 16), 0x00);
	formatBody.writeUInt16LE(1, 0);
	formatBody.writeUInt16LE(2, 2);
	formatBody.writeUInt32LE(22050, 4);
	formatBody.writeUInt32LE(22050 * 4, 8);
	formatBody.writeUInt16LE(4, 12);
	formatBody.writeUInt16LE(16, 14);
	const body = formatBody.subarray(0, formatLength);
	const pcm = buildPcm();
	const data = Buffer.concat([
		Buffer.from("data", "latin1"),
		(() => {
			const size: Buffer = Buffer.alloc(4);
			size.writeUInt32LE(pcm.length, 0);
			return size;
		})(),
		pcm,
	]);
	const trailing = options.trailingChunk ?? Buffer.alloc(0);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(4 + (8 + formatLength) + trailing.length + data.length, 0);
	return Buffer.concat([
		Buffer.from("RIFF", "latin1"),
		size,
		Buffer.from("WAVE", "latin1"),
		Buffer.from("fmt ", "latin1"),
		(() => {
			const length: Buffer = Buffer.alloc(4);
			length.writeUInt32LE(formatLength, 0);
			return length;
		})(),
		body,
		trailing,
		data,
	]);
}

/** Zeroes the two marker runs, leaving the size field and everything from offset sixteen intact. */
function obfuscate(wave: Buffer): Buffer {
	const stored = Buffer.from(wave);
	stored.fill(0, 0, 4);
	stored.fill(0, 8, PREFIX_SIZE);
	return stored;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("bef vzy audio", () => {
	it("declares no signature and no extension", () => {
		expect(vzyAudioFormat.detection?.signatures).toEqual([]);
		expect(vzyAudioFormat.descriptor.extensions).toEqual([]);
	});

	it("rebuilds the wave header and writes a canonical wave file", async () => {
		const wave = buildWave();
		const stored = obfuscate(wave);
		const source = sourceOf(stored);
		expect(await vzyAudioFormat.detect(source, "SE01.VZY")).toBe(true);
		const archive = await vzyAudioFormat.open(source, "SE01.VZY");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SE01.wav"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				type: "audio",
				format: "wav",
				formatTag: 1,
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 16,
				encrypted: true,
				pcmSize: PCM_SIZE,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The prefix plus the stored tail is the original file, byte for byte.
			expect(output).toEqual(wave);
		} finally {
			await archive.close();
		}
	});

	it("drops chunks after the data chunk", async () => {
		// A `LIST` chunk past the payload is not carried into the canonical output.
		const extra = Buffer.concat([
			Buffer.from("LIST", "latin1"),
			Buffer.from([4, 0, 0, 0]),
			Buffer.from("INFO", "latin1"),
		]);
		const wave = buildWave({ trailingChunk: Buffer.alloc(0) });
		const withExtra = Buffer.concat([wave, extra]);
		// The declared length covers the trailing chunk too.
		withExtra.writeUInt32LE(withExtra.length - 8, 4);
		const stored = obfuscate(withExtra);
		const archive = await vzyAudioFormat.open(sourceOf(stored), "SE01.VZY");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(wave.length);
			expect(output).toEqual(wave);
		} finally {
			await archive.close();
		}
	});

	it("requires the declared length to match the file", async () => {
		const stored = Buffer.concat([
			obfuscate(buildWave()),
			Buffer.alloc(1, 0x77),
		]);
		expect(await vzyAudioFormat.detect(sourceOf(stored), "SE01.VZY")).toBe(
			false,
		);
	});

	it("requires the marker bytes to be zero", async () => {
		const stored = obfuscate(buildWave());
		stored[0] = 0x52;
		expect(await vzyAudioFormat.detect(sourceOf(stored), "SE01.VZY")).toBe(
			false,
		);
		const other = obfuscate(buildWave());
		other[9] = 0x41;
		expect(await vzyAudioFormat.detect(sourceOf(other), "SE01.VZY")).toBe(
			false,
		);
	});

	it("rejects a format chunk length out of range", async () => {
		// Fifteen bytes is below the minimum; the reference also requires it within the declared length.
		const stored = obfuscate(buildWave({ formatLength: 15 }));
		stored.writeUInt16LE(15, 0x10);
		expect(await vzyAudioFormat.detect(sourceOf(stored), "SE01.VZY")).toBe(
			false,
		);
		const big = obfuscate(buildWave());
		big.writeUInt16LE(0x7fff, 0x10);
		expect(await vzyAudioFormat.detect(sourceOf(big), "SE01.VZY")).toBe(false);
	});

	it("rejects a missing data marker and truncated files", async () => {
		const wave = buildWave();
		const noData = Buffer.from(wave);
		noData.write("list", 0x24, "latin1");
		const stored = obfuscate(noData);
		expect(await vzyAudioFormat.detect(sourceOf(stored), "SE01.VZY")).toBe(
			false,
		);
		expect(
			await vzyAudioFormat.detect(
				sourceOf(buildWave().subarray(0, 17)),
				"SE01.VZY",
			),
		).toBe(false);
		// The header itself fits, but the format body does not.
		const short = obfuscate(buildWave()).subarray(0, 0x18);
		expect(await vzyAudioFormat.detect(sourceOf(short), "SE01.VZY")).toBe(
			false,
		);
	});
});
