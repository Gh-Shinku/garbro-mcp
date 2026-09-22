import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { regripsMrgAudioFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

/** Two MPEG-1 Layer III frames: 128 kbps at 44100 Hz gives 417 bytes per frame. */
function buildMp3(): Buffer {
	const frameLength = Math.floor((144000 * 128) / 44100);
	const frames = [
		Buffer.alloc(frameLength, 0x5c),
		Buffer.alloc(frameLength, 0x5c),
	];
	for (const frame of frames) {
		frame[0] = 0xff;
		frame[1] = 0xfb;
		frame[2] = 0x90;
		frame[3] = 0x64;
	}
	return Buffer.concat(frames);
}

function scramble(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ 0xff;
	return output;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("regrips mrg audio", () => {
	it("declares no signature, since the reference has none", () => {
		expect(regripsMrgAudioFormat.detection?.signatures).toEqual([]);
	});

	it("restores the mp3", async () => {
		const mp3 = buildMp3();
		const stored = scramble(mp3);
		// The stored first byte is zero, which is what the reference checks: the decoded byte is the
		// `0xFF` that begins the frame.
		expect(stored[0]).toBe(0);
		expect(mp3[0]).toBe(0xff);
		const source = sourceOf(stored);
		expect(await regripsMrgAudioFormat.detect(source, "BGM01.MRG")).toBe(true);
		const archive = await regripsMrgAudioFormat.open(source, "BGM01.MRG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.mp3"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				audio: "mp3",
				encrypted: true,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// Inverting preserves length, so the listed size is the extracted one.
			expect(entry.size).toBe(BigInt(stored.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(mp3);
			expect(output.readUInt16BE(0)).toBe(0xfffb);
		} finally {
			await archive.close();
		}
	});

	it("declines a plain unscrambled mp3", async () => {
		const mp3 = buildMp3();
		// An unscrambled mp3 starts with `0xFF`, and the reference requires a zero first byte.
		expect(await regripsMrgAudioFormat.detect(sourceOf(mp3), "BGM01.MRG")).toBe(
			false,
		);
	});

	it("declines a scrambled stream without a frame header", async () => {
		// The first byte decodes to `0xFF` but nothing else looks like a frame.
		const body: Buffer = Buffer.alloc(0x40, 0x5c);
		body[0] = 0x00;
		body[1] = 0x00;
		const stored = scramble(body);
		expect(
			await regripsMrgAudioFormat.detect(sourceOf(stored), "BGM01.MRG"),
		).toBe(false);
	});

	it("declines leading zeroes that only resemble an inverted frame sync", async () => {
		const stored = Buffer.alloc(0x400, 0x00);
		expect(
			await regripsMrgAudioFormat.detect(sourceOf(stored), "picture.ico"),
		).toBe(false);
	});

	it("declines a single plausible frame without a following frame", async () => {
		const mp3 = buildMp3().subarray(0, 417);
		expect(
			await regripsMrgAudioFormat.detect(sourceOf(scramble(mp3)), "movie.mp4"),
		).toBe(false);
	});

	it("declines a stream whose inverted frame header is truncated", async () => {
		// A single `0xFF` byte with no second byte cannot describe a frame.
		const stored = Buffer.from([0x00]);
		expect(
			await regripsMrgAudioFormat.detect(sourceOf(stored), "BGM01.MRG"),
		).toBe(false);
	});

	it("declines a different first byte", async () => {
		const stored = scramble(buildMp3());
		stored[0] = 0x01;
		expect(
			await regripsMrgAudioFormat.detect(sourceOf(stored), "BGM01.MRG"),
		).toBe(false);
	});

	it("declines an ID3 prefixed stream, which the first byte rule rules out", async () => {
		// An mp3 preceded by an ID3 tag has its frame header at a later offset, so its scrambled first
		// byte is not zero and the reference rejects it before looking any further.
		const tagged = Buffer.concat([
			Buffer.from("ID3\x04\x00\x00\x00\x00\x00\x00", "latin1"),
			buildMp3(),
		]);
		const stored = scramble(tagged);
		expect(stored[0]).not.toBe(0);
		expect(
			await regripsMrgAudioFormat.detect(sourceOf(stored), "BGM03.MRG"),
		).toBe(false);
	});
});
