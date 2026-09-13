import { BufferByteSource } from "@garbro-mcp/core";
import { agsAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE_WORD = 0x66424047;
const RIFF_SIGNATURE = 0x46464952;
const BLOCK_SIZE = 4;
const PERIOD = 31;

function rotateLeft32(value: number, count: number): number {
	const shift = count & 31;
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** The same keystream the port uses, so encryption is a plain exclusive-or away. */
function crypt(data: Buffer, key: number): Buffer {
	const output: Buffer = Buffer.alloc(data.length);
	for (let i = 0; i < data.length; i += 1) {
		const quotient = Math.floor(i / BLOCK_SIZE / PERIOD);
		const remainder = Math.floor(i / BLOCK_SIZE) % PERIOD;
		const word = rotateLeft32((key + quotient) >>> 0, remainder);
		const mask = (word >>> ((i % BLOCK_SIZE) * 8)) & 0xff;
		output[i] = (data[i] ?? 0) ^ mask;
	}
	return output;
}

/** A plain wave file long enough to cross a keystream period boundary. */
function plainWave(): Buffer {
	const body = Buffer.alloc(0x100, 0x40);
	const header = Buffer.alloc(12, 0);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(body.length + 36, 4);
	header.write("WAVE", 8, "latin1");
	return Buffer.concat([header, body]);
}

interface Built {
	file: Buffer;
	plain: Buffer;
	key: number;
}

/**
 * Builds an encrypted wave file. The stored signature word is one of the two the reference accepts,
 * and it determines the key.
 */
function buildAgs(signatureWord = SIGNATURE_WORD, plain = plainWave()): Built {
	const key = (signatureWord ^ RIFF_SIGNATURE) >>> 0;
	const encrypted = crypt(plain, key);
	const header = Buffer.alloc(4);
	header.writeUInt32LE(signatureWord, 0);
	encrypted.set(header.subarray(0, 4), 0);
	return { file: encrypted, plain, key };
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ags32i wav audio", () => {
	it("declares both accepted signature words", () => {
		expect(agsAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0x47, 0x40, 0x42, 0x66]) },
			{ bytes: Buffer.alloc(4) },
		]);
	});

	it("decrypts the whole wave file", async () => {
		const { file, plain, key } = buildAgs();
		const source = sourceOf(file);
		expect(await agsAudioFormat.detect(source, "SE01.WAV")).toBe(true);
		const archive = await agsAudioFormat.open(source, "SE01.WAV");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SE01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "wav", key });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The cipher keeps the length.
			expect(Number(entry.size)).toBe(file.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("uses the key implied by the zero signature", async () => {
		const { file, key } = buildAgs(0);
		expect(key).toBe(RIFF_SIGNATURE);
		// Forcing the stored signature rewrites the first four plaintext bytes as well.
		const expected = crypt(file, key);
		expect(expected.subarray(8, 12).toString("latin1")).toBe("WAVE");
		const source = sourceOf(file);
		expect(await agsAudioFormat.detect(source, "SE02.WAV")).toBe(true);
		const archive = await agsAudioFormat.open(source, "SE02.WAV");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				expected,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose wave tag does not survive decryption", async () => {
		const { file } = buildAgs();
		file[8] = (file[8] ?? 0) ^ 0x01;
		expect(await agsAudioFormat.detect(sourceOf(file), "SE01.WAV")).toBe(false);
	});

	it("declines an unknown signature word", async () => {
		const { file } = buildAgs();
		file.writeUInt32LE(0x12345678, 0);
		expect(await agsAudioFormat.detect(sourceOf(file), "SE01.WAV")).toBe(false);
	});

	it("declines a file without a full header", async () => {
		const { file } = buildAgs();
		expect(
			await agsAudioFormat.detect(sourceOf(file.subarray(0, 8)), "SE01.WAV"),
		).toBe(false);
	});
});
