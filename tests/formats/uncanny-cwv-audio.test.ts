import { BufferByteSource } from "@garbro-mcp/core";
import { cwvAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const INITIAL_KEY = 0x4b5ab4a5;
const HEADER_SIZE = 0x10;

/**
 * An independent transcription of the reference cipher as an **encryptor**: the keystream byte is XORed
 * into the plaintext, and the update absorbs the plaintext, which is what makes the port's decryptor its
 * inverse. Written as a plain loop so it shares no code with the port.
 */
function cipher(data: Buffer): Buffer {
	const output = Buffer.alloc(data.length);
	let key = INITIAL_KEY >>> 0;
	for (let i = 0; i < data.length; i += 1) {
		const plain = data.readUInt8(i);
		const encrypted = ((key & 0xff) ^ plain) & 0xff;
		output[i] = encrypted;
		const rotated = (((key << 9) >>> 0) | ((key >>> 23) & 0x1f0)) >>> 0;
		// Absorbing the plaintext keeps this the exact inverse of the port's decryptor.
		key = (rotated ^ plain) >>> 0;
	}
	return output;
}

/** A minimal but well formed WAV file: RIFF, a sixteen byte fmt chunk and a data chunk. */
function buildWav(pcmSize = 0x20): Buffer {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 3) & 0xff;
	const header: Buffer = Buffer.alloc(44);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVEfmt ", 8, "latin1");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(22050, 24);
	header.writeUInt32LE(22050, 28);
	header.writeUInt16LE(1, 32);
	header.writeUInt16LE(8, 34);
	header.write("data", 36, "latin1");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("uncanny cwv audio", () => {
	it("declares the encrypted RIFF signature for the registry", () => {
		expect(cwvAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from([0xf7, 0x8b, 0x6f, 0xa0]) },
		]);
	});

	it("produces the declared signature for a RIFF file", () => {
		// A cross check of the cipher against the signature the reference declares: the first four
		// encrypted bytes of "RIFF" have to be exactly that word.
		expect(cipher(Buffer.from("RIFF", "ascii"))).toEqual(
			Buffer.from([0xf7, 0x8b, 0x6f, 0xa0]),
		);
	});

	it("decrypts the whole file back to a wave", async () => {
		const wav = buildWav();
		const stored = cipher(wav);
		const source = sourceOf(stored);
		expect(await cwvAudioFormat.detect(source, "BGM01.CWV")).toBe(true);
		const archive = await cwvAudioFormat.open(source, "BGM01.CWV");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				encrypted: true,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			// The cipher is length preserving, so the wave comes back byte for byte.
			expect(output.length).toBe(stored.length);
			expect(output).toEqual(wav);
			expect(output.subarray(0, 4).toString("latin1")).toBe("RIFF");
			expect(output.subarray(8, 16).toString("latin1")).toBe("WAVEfmt ");
		} finally {
			await archive.close();
		}
	});

	it("declines encrypted data that is not a wave", async () => {
		const junk = cipher(Buffer.alloc(0x40, 0x7a));
		expect(await cwvAudioFormat.detect(sourceOf(junk), "BGM01.CWV")).toBe(
			false,
		);
	});

	it("declines a file shorter than the header", async () => {
		expect(
			await cwvAudioFormat.detect(
				sourceOf(cipher(buildWav()).subarray(0, HEADER_SIZE - 8)),
				"BGM01.CWV",
			),
		).toBe(false);
	});
});
