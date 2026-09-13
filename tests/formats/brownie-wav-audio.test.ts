import { BufferByteSource } from "@garbro-mcp/core";
import { brownieWavAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x67, 0x23, 0x74, 0x58]);
const KEY = 0x5c;
const HEADER_SIZE = 0x10;
const BODY = Buffer.alloc(0x40, 0x3c);

/** Builds a plain wave file: a RIFF header followed by the audio body. */
function plainWave(): Buffer {
	const header = Buffer.alloc(HEADER_SIZE, 0);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(BODY.length + 36, 4);
	header.write("WAVE", 8, "latin1");
	return Buffer.concat([header, BODY]);
}

/** Masks a plain wave file the way the reference expects to find it. */
function buildWav(plain: Buffer = plainWave()): Buffer {
	const stored: Buffer = Buffer.alloc(plain.length);
	SIGNATURE.copy(stored, 0);
	for (let i = 4; i < HEADER_SIZE; i += 1) stored[i] = (plain[i] ?? 0) ^ KEY;
	// Only the body follows the header; copying the whole file here would shift it.
	plain.subarray(HEADER_SIZE).copy(stored, HEADER_SIZE);
	return stored;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("brownie wav audio", () => {
	it("declares the stored signature for the registry", () => {
		expect(brownieWavAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
	});

	it("restores the obfuscated wave header", async () => {
		const plain = plainWave();
		const file = buildWav(plain);
		const source = sourceOf(file);
		expect(await brownieWavAudioFormat.detect(source, "SE01.WAV")).toBe(true);
		const archive = await brownieWavAudioFormat.open(source, "SE01.WAV");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SE01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({ audio: "wav", key: KEY });
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// Rebuilding the header keeps the length.
			expect(Number(entry.size)).toBe(file.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				plain,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose masked header is not a wave", async () => {
		const file = buildWav();
		file[8] = (file[8] ?? 0) ^ 0x01;
		expect(await brownieWavAudioFormat.detect(sourceOf(file), "SE01.WAV")).toBe(
			false,
		);
	});

	it("declines a file without the stored signature", async () => {
		const file = buildWav();
		file[0] = 0x68;
		expect(await brownieWavAudioFormat.detect(sourceOf(file), "SE01.WAV")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await brownieWavAudioFormat.detect(sourceOf(Buffer.alloc(8)), "SE01.WAV"),
		).toBe(false);
	});
});
