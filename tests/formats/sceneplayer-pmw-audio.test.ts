import { deflateSync, inflateSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { pmwAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const XOR_KEY = 0x21;
const PCM_SIZE = 24;

function buildPcm(): Buffer {
	const pcm: Buffer = Buffer.alloc(PCM_SIZE);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 29 + 11) & 0xff;
	return pcm;
}

/** A wave file with a sixteen byte format chunk and an optional chunk after the payload. */
function buildWave(extra: Buffer = Buffer.alloc(0)): Buffer {
	const pcm = buildPcm();
	const data = Buffer.concat([
		Buffer.from("data", "latin1"),
		(() => {
			const size: Buffer = Buffer.alloc(4);
			size.writeUInt32LE(pcm.length, 0);
			return size;
		})(),
		pcm,
		extra,
	]);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(4 + 24 + data.length, 0);
	const format: Buffer = Buffer.alloc(16, 0x00);
	format.writeUInt16LE(1, 0);
	format.writeUInt16LE(2, 2);
	format.writeUInt32LE(22050, 4);
	format.writeUInt32LE(22050 * 4, 8);
	format.writeUInt16LE(4, 12);
	format.writeUInt16LE(16, 14);
	return Buffer.concat([
		Buffer.from("RIFF", "latin1"),
		size,
		Buffer.from("WAVE", "latin1"),
		Buffer.from("fmt ", "latin1"),
		(() => {
			const length: Buffer = Buffer.alloc(4);
			length.writeUInt32LE(16, 0);
			return length;
		})(),
		format,
		data,
	]);
}

function mask(input: Buffer): Buffer {
	const output = Buffer.alloc(input.length);
	for (let i = 0; i < input.length; i += 1)
		output[i] = (input[i] ?? 0) ^ XOR_KEY;
	return output;
}

function buildPmw(wave = buildWave()): Buffer {
	return mask(deflateSync(wave));
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("sceneplayer pmw audio", () => {
	it("declares no signature and no extension", () => {
		expect(pmwAudioFormat.detection?.signatures).toEqual([]);
		expect(pmwAudioFormat.descriptor.extensions).toEqual([]);
	});

	it("unmasks and inflates a wave file", async () => {
		const wave = buildWave();
		const stored = buildPmw(wave);
		// The reference peeks the first byte and unmasks it, so the stored value is the masked zlib CMF.
		expect((stored[0] ?? 0) ^ XOR_KEY).toBe(0x78);
		const source = sourceOf(stored);
		expect(await pmwAudioFormat.detect(source, "SE01.PMW")).toBe(true);
		const archive = await pmwAudioFormat.open(source, "SE01.PMW");
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
			expect(output).toEqual(wave);
		} finally {
			await archive.close();
		}
	});

	it("drops chunks after the data chunk", async () => {
		const extra = Buffer.concat([
			Buffer.from("LIST", "latin1"),
			Buffer.from([4, 0, 0, 0]),
			Buffer.from("INFO", "latin1"),
		]);
		const wave = buildWave();
		const withExtra = Buffer.concat([wave, extra]);
		withExtra.writeUInt32LE(withExtra.length - 8, 4);
		const archive = await pmwAudioFormat.open(
			sourceOf(buildPmw(withExtra)),
			"SE01.PMW",
		);
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

	it("declines a payload that is not a wave file", async () => {
		const stored = mask(deflateSync(Buffer.from("not a wave file", "latin1")));
		expect(await pmwAudioFormat.detect(sourceOf(stored), "SE01.PMW")).toBe(
			false,
		);
	});

	it("declines a wrong first byte and an unmasked file", async () => {
		const wrong = buildPmw();
		wrong[0] = 0x7a;
		expect(await pmwAudioFormat.detect(sourceOf(wrong), "SE01.PMW")).toBe(
			false,
		);
		// Stored without the mask the first byte is the plain zlib CMF and the mask check rejects it.
		const plain = deflateSync(buildWave());
		expect(plain[0]).toBe(0x78);
		expect(await pmwAudioFormat.detect(sourceOf(plain), "SE01.PMW")).toBe(
			false,
		);
	});

	it("declines a corrupted stream and a one byte file", async () => {
		const corrupted = buildPmw();
		corrupted[6] = (corrupted[6] ?? 0) ^ 0xff;
		expect(await pmwAudioFormat.detect(sourceOf(corrupted), "SE01.PMW")).toBe(
			false,
		);
		expect(
			await pmwAudioFormat.detect(
				sourceOf(buildPmw().subarray(0, 1)),
				"SE01.PMW",
			),
		).toBe(false);
	});

	it("round trips through the mask relation", () => {
		const stored = buildPmw();
		const recovered = mask(stored);
		expect(recovered[0]).toBe(0x78);
		expect(() => inflateSync(recovered)).not.toThrow();
	});
});
