import { BufferByteSource } from "@garbro-mcp/core";
import { pisckissAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const VARIANT_BITS = 0x42;
const KEY_MASK = 0xbd;
const KEY_SEED = 0x6a8cd4e7;

/** The same register the port uses: a new bit from bits 31 and 16, and the low byte is the key byte. */
function keystream(first: number, length: number): Buffer {
	const bytes: number[] = [];
	let key = ((first & KEY_MASK) ^ KEY_SEED) >>> 0;
	for (let index = 0; index < length; index += 1) {
		bytes.push(key & 0xff);
		const feedback = ((key & 0x10000) ^ (key >>> 15)) >>> 16;
		key = ((key << 1) | (feedback & 1)) >>> 0;
	}
	return Buffer.from(bytes);
}

function crypt(payload: Buffer, first: number): Buffer {
	const key = keystream(first, payload.length);
	const out = Buffer.alloc(payload.length);
	for (let index = 0; index < payload.length; index += 1) {
		out[index] = (payload[index] ?? 0) ^ (key[index] ?? 0);
	}
	return out;
}

/** A canonical eight bit mono wave, which is what the reference's wave reader produces from one. */
function buildWave(samples: number[], sampleRate = 8000): Buffer {
	const fmt: Buffer = Buffer.alloc(16, 0x00);
	fmt.writeUInt16LE(1, 0);
	fmt.writeUInt16LE(1, 2);
	fmt.writeUInt32LE(sampleRate, 4);
	fmt.writeUInt32LE(sampleRate, 8);
	fmt.writeUInt16LE(1, 12);
	fmt.writeUInt16LE(8, 14);
	const pcm = Buffer.from(samples);
	return Buffer.concat([
		Buffer.from("RIFF", "latin1"),
		Buffer.from([
			(36 + pcm.length) & 0xff,
			((36 + pcm.length) >> 8) & 0xff,
			0,
			0,
		]),
		Buffer.from("WAVEfmt ", "latin1"),
		Buffer.from([16, 0, 0, 0]),
		fmt,
		Buffer.from("data", "latin1"),
		Buffer.from([pcm.length & 0xff, (pcm.length >> 8) & 0xff, 0, 0]),
		pcm,
	]);
}

/**
 * The file is one key seed byte, the encrypted payload, and the bytes the tag says are not payload. The default
 * first byte carries exactly one of the two tag bits, since a byte with neither of them is not a Pisckiss file.
 */
function buildPisckiss(payload: Buffer, first = 0x40): Buffer {
	const trimmed = (first & VARIANT_BITS) === VARIANT_BITS ? 3 : 1;
	const trailing = trimmed - 1;
	return Buffer.concat([
		Buffer.from([first]),
		crypt(payload, first),
		Buffer.alloc(trailing, 0x5a),
	]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(file: Buffer, name = "SE_01.WAV"): Promise<Buffer> {
	const archive = await pisckissAudioFormat.open(sourceOf(file), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("pisckiss encrypted audio", () => {
	it("declares no signature, no extension and the write limitation", () => {
		expect(pisckissAudioFormat.detection?.signatures).toEqual([]);
		expect(pisckissAudioFormat.descriptor.extensions).toEqual([]);
		expect(pisckissAudioFormat.descriptor.capabilities).toMatchObject({
			create: false,
			encryption: true,
		});
	});

	it("switches on the two guarded bits of the first byte", async () => {
		const payload = Buffer.from("OggS-ish payload", "latin1");
		for (const first of [0x42, 0x40, 0x02]) {
			expect(
				await pisckissAudioFormat.detect(
					sourceOf(buildPisckiss(payload, first)),
					"A.wav",
				),
			).toBe(true);
		}
		// With both bits clear the reference returns null, so no key is even computed.
		for (const first of [0x00, 0x80, 0x01, 0xbd & ~VARIANT_BITS]) {
			expect(
				await pisckissAudioFormat.detect(
					sourceOf(buildPisckiss(payload, first)),
					"A.wav",
				),
			).toBe(false);
		}
	});

	it("shifts the same register the reference does", async () => {
		// The tag bits are masked out of the seed, so a first byte of 0x40 gives the bare seed: the register's
		// first two bytes are then hand computable as 0x6A8CD4E7, and bit 31 xor bit 16 is one xor one, which
		// leaves 0xD519A9CE. A tag byte of 0x02 gives exactly the same pair.
		expect([...keystream(0x40, 2)]).toEqual([0xe7, 0xce]);
		expect([...keystream(0x02, 2)]).toEqual([0xe7, 0xce]);
		const file = buildPisckiss(Buffer.from("RIFF....", "latin1"));
		expect(file[1]).toBe(0x52 ^ 0xe7);
		expect(file[2]).toBe(0x49 ^ 0xce);
	});

	it("drops three bytes with both bits set and one with a single bit", async () => {
		const payload = Buffer.from("OggS payload bytes", "latin1");
		// Both bits set means two bytes beyond the payload; a single bit means one. The payload itself is the
		// same either way, which is what the extraction proves.
		for (const first of [0x42, 0x40, 0x02]) {
			const file = buildPisckiss(payload, first);
			expect(file.length).toBe(
				1 + payload.length + ((first & VARIANT_BITS) === VARIANT_BITS ? 2 : 0),
			);
			expect(await extract(file, "SE.OGG")).toEqual(payload);
		}
	});

	it("re-serialises a wave from its samples", async () => {
		const wave = buildWave([0x10, 0x20, 0x30, 0x40]);
		const output = await extract(buildPisckiss(wave));
		expect(output.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(output.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(output.subarray(12, 16).toString("latin1")).toBe("fmt ");
		expect(output.readUInt32LE(24)).toBe(8000);
		// A canonical forty four byte header, so the data chunk starts where the writer puts it.
		expect(output.subarray(36, 40).toString("latin1")).toBe("data");
		expect(output.readUInt32LE(40)).toBe(4);
		expect(output.subarray(44)).toEqual(Buffer.from([0x10, 0x20, 0x30, 0x40]));
	});

	it("names the entry after the container the marker chose", async () => {
		for (const [payload, extension] of [
			[buildWave([1, 2]), "wav"],
			[Buffer.from("OggS payload", "latin1"), "ogg"],
		] as const) {
			const archive = await pisckissAudioFormat.open(
				sourceOf(buildPisckiss(payload)),
				"SE_01.WAV",
			);
			try {
				expect(archive.entries[0]?.path).toBe(`SE_01.${extension}`);
				expect(archive.entries[0]?.sizeKnown).toBe(false);
				expect(archive.metadata).toMatchObject({ audio: extension });
			} finally {
				await archive.close();
			}
		}
	});

	it("declines an unknown marker or a file too short for one", async () => {
		expect(
			await pisckissAudioFormat.detect(
				sourceOf(buildPisckiss(Buffer.from("ABCD", "latin1"))),
				"A.wav",
			),
		).toBe(false);
		expect(
			await pisckissAudioFormat.detect(
				sourceOf(buildPisckiss(Buffer.from("OggS", "latin1")).subarray(0, 4)),
				"A.wav",
			),
		).toBe(false);
		expect(
			await pisckissAudioFormat.detect(sourceOf(Buffer.alloc(3)), "A.wav"),
		).toBe(false);
	});

	it("rejects a RIFF marker whose payload is not a wave", async () => {
		// The marker check only looks at four bytes; a payload that names RIFF but carries no chunks fails in
		// the reference's wave reader, and so it fails here.
		const file = buildPisckiss(
			Buffer.concat([Buffer.from("RIFF", "latin1"), Buffer.alloc(8, 0x00)]),
		);
		expect(await pisckissAudioFormat.detect(sourceOf(file), "A.wav")).toBe(
			true,
		);
		await expect(extract(file)).rejects.toThrow();
	});
});
