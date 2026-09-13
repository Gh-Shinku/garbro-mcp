import { BufferByteSource } from "@garbro-mcp/core";
import { ikeAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0x9d, 0x89, 0x69, 0x6b]);
/** The codec starts here, and its first two bytes are the flag word. */
const STREAM_OFFSET = 0x0d;
const WAVE_MARKER_OFFSET = 0x0f;
const SIZE_BYTES_OFFSET = 10;

/**
 * The Ike bit stream writer, the same one the UMeSoft BIN fixture uses: sixteen bit words of flag bits and
 * the literal bytes of each word after it. A set flag means a literal, so a stream of nothing but literals
 * is `bit(1), byte(byte)` per byte, and the first literal lands two bytes into the stream.
 */
class IkeWriter {
	readonly out: number[] = [];
	#word = 0;
	#bits = 0;
	#bytes: number[] = [];

	bit(value: number): void {
		this.#word |= (value & 1) << this.#bits;
		this.#bits += 1;
		if (this.#bits === 16) this.#flush();
	}

	byte(value: number): void {
		this.#bytes.push(value & 0xff);
	}

	#flush(): void {
		this.out.push(this.#word & 0xff, (this.#word >> 8) & 0xff, ...this.#bytes);
		this.#word = 0;
		this.#bits = 0;
		this.#bytes = [];
	}

	finish(): Buffer {
		if (this.#bits > 0 || this.#bytes.length > 0) this.#flush();
		return Buffer.from(this.out);
	}
}

/** Encodes a payload as literal tokens, one flag bit and one byte each. */
function encodeIkeLiterals(content: Buffer): Buffer {
	const writer = new IkeWriter();
	for (const byte of content) {
		writer.bit(1);
		writer.byte(byte);
	}
	return writer.finish();
}

/** `DecodeSize (a, b, c) = b + ((c + (a >> 2 << 8)) << 8)`, so the high six bits come first. */
function encodeIkeSize(size: number): Buffer {
	return Buffer.from([(size >>> 16) << 2, size & 0xff, (size >>> 8) & 0xff]);
}

/** A canonical sixteen bit mono wave. */
function buildWave(pcm: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(44, 0x00);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(36 + pcm.length, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 12, "latin1");
	header.writeUInt32LE(16, 16);
	header.writeUInt16LE(1, 20);
	header.writeUInt16LE(1, 22);
	header.writeUInt32LE(22050, 24);
	header.writeUInt32LE(44100, 28);
	header.writeUInt16LE(2, 32);
	header.writeUInt16LE(16, 34);
	header.write("data", 36, "latin1");
	header.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([header, pcm]);
}

/** The thirteen header bytes, then the codec's stream from 0x0D on. */
function buildIke(payload: Buffer, declaredSize?: number): Buffer {
	const header: Buffer = Buffer.alloc(STREAM_OFFSET, 0x00);
	SIGNATURE.copy(header, 0);
	header.write("ike", 2, "latin1");
	encodeIkeSize(declaredSize ?? payload.length).copy(header, SIZE_BYTES_OFFSET);
	return Buffer.concat([header, encodeIkeLiterals(payload)]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "SOUND.IKE"): Promise<Buffer> {
	const archive = await ikeAudioFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

async function expectExtractionFails(stored: Buffer): Promise<void> {
	expect(await ikeAudioFormat.detect(sourceOf(stored), "SOUND.IKE")).toBe(true);
	const archive = await ikeAudioFormat.open(sourceOf(stored), "SOUND.IKE");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		await expect(archive.openEntry(entry.id)).rejects.toThrow();
	} finally {
		await archive.close();
	}
}

describe("ume-soft ike audio", () => {
	it("declares the little endian signature and no extension", () => {
		expect(ikeAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.readUInt32LE(0)).toBe(0x6b69899d);
		expect(ikeAudioFormat.descriptor.extensions).toEqual([]);
	});

	it("unpacks an ike stream back into a wave", async () => {
		const pcm = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);
		const wave = buildWave(pcm);
		const stored = buildIke(wave);
		// The two offsets the reference checks really are adjacent: the stream starts at 0x0D with a sixteen
		// bit flag word, so the wave's `R` is the first literal and sits at 0x0F.
		expect(stored.subarray(STREAM_OFFSET, WAVE_MARKER_OFFSET)).toHaveLength(2);
		expect(
			stored.toString("latin1", WAVE_MARKER_OFFSET, WAVE_MARKER_OFFSET + 4),
		).toBe("RIFF");
		const source = sourceOf(stored);
		expect(await ikeAudioFormat.detect(source, "SOUND.IKE")).toBe(true);
		const archive = await ikeAudioFormat.open(source, "SOUND.IKE");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SOUND.wav"]);
			expect(archive.entries[0]?.compressed).toBe(true);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				compression: "ike",
				unpackedSize: wave.length,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output).toEqual(wave);
	});

	it("declines a stream whose first literal is not a wave header", async () => {
		const stored = buildIke(buildWave(Buffer.alloc(4)));
		// The marker check at 0x0F reads the compressed stream's first literal, so changing it is the only way
		// to break that one check while leaving the header's own bytes intact.
		stored[WAVE_MARKER_OFFSET] = 0x4b;
		expect(await ikeAudioFormat.detect(sourceOf(stored), "SOUND.IKE")).toBe(
			false,
		);
	});

	it("declines a wrong marker byte and a wrong signature", async () => {
		const stored = buildIke(buildWave(Buffer.alloc(4)));
		// Bytes two and three are part of the signature; only the `e` at offset four is not.
		expect(stored.readUInt32LE(0)).toBe(0x6b69899d);
		expect(stored.toString("latin1", 2, 5)).toBe("ike");
		stored[4] = 0x78;
		expect(await ikeAudioFormat.detect(sourceOf(stored), "SOUND.IKE")).toBe(
			false,
		);
		const other = buildIke(buildWave(Buffer.alloc(4)));
		other[0] = 0x00;
		expect(await ikeAudioFormat.detect(sourceOf(other), "SOUND.IKE")).toBe(
			false,
		);
	});

	it("declines a zero unpacked size and truncates one the field cannot hold", async () => {
		const wave = buildWave(Buffer.alloc(4));
		const zero = buildIke(wave, 0);
		expect(await ikeAudioFormat.detect(sourceOf(zero), "SOUND.IKE")).toBe(
			false,
		);
		// The three byte field holds six significant bits in its first byte, so the largest size it can name
		// is 0x3FFFFF. Anything above that truncates rather than being rejected: 0x4000000 becomes zero,
		// which the format declines, while 0x4000001 becomes one, which it reads as a one byte wave.
		expect(encodeIkeSize(0x3fffff)).toEqual(Buffer.from([0xfc, 0xff, 0xff]));
		expect(encodeIkeSize(0x4000000)).toEqual(Buffer.from([0x00, 0x00, 0x00]));
		expect(encodeIkeSize(0x4000001)).toEqual(Buffer.from([0x00, 0x01, 0x00]));
		const truncated = buildIke(wave, 0x4000000);
		expect(await ikeAudioFormat.detect(sourceOf(truncated), "SOUND.IKE")).toBe(
			false,
		);
		const good = buildIke(wave);
		expect(await ikeAudioFormat.detect(sourceOf(good), "SOUND.IKE")).toBe(true);
	});

	it("lists a payload that is not a wave and fails when it is extracted", async () => {
		// The header markers hold, so the format accepts the file; `Wav.TryOpen` is what rejects it, and a
		// listing cannot afford to decompress. `RIFF` stays at 0x0F because that is a literal of the stream.
		const payload = Buffer.concat([
			Buffer.from("RIFF", "latin1"),
			Buffer.alloc(40, 0x41),
		]);
		const stored = buildIke(payload);
		expect(
			stored.toString("latin1", WAVE_MARKER_OFFSET, WAVE_MARKER_OFFSET + 4),
		).toBe("RIFF");
		await expectExtractionFails(stored);
	});

	it("fails when the stream is shorter than the declared size", async () => {
		const wave = buildWave(Buffer.alloc(4));
		const stored = Buffer.concat([
			buildIke(wave).subarray(0, STREAM_OFFSET + 6),
			encodeIkeLiterals(wave.subarray(0, 4)),
		]);
		expect(await ikeAudioFormat.detect(sourceOf(stored), "SOUND.IKE")).toBe(
			true,
		);
		await expectExtractionFails(stored);
	});

	it("ignores bytes after the wave data", async () => {
		const pcm = Buffer.from([0x11, 0x22, 0x33, 0x44]);
		const wave = Buffer.concat([buildWave(pcm), Buffer.from([0xde, 0xad])]);
		const stored = buildIke(wave);
		// The trailing bytes are part of the payload, so the size covers them, but the re-emitted wave drops
		// them because the data chunk ends first.
		expect(await ikeAudioFormat.detect(sourceOf(stored), "SOUND.IKE")).toBe(
			true,
		);
		const output = await extract(stored);
		expect(output).toEqual(buildWave(pcm));
		expect(output.length).toBe(wave.length - 2);
	});
});
