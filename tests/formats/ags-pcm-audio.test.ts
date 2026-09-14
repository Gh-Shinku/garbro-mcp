import { BufferByteSource } from "@garbro-mcp/core";
import { agsPcmAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PCM = Buffer.alloc(0x40);
for (let i = 0; i < PCM.length; i += 1) PCM[i] = (i * 5 + 1) & 0xff;

/** A sound file: the three letters `WAV`, a type byte and the sound itself. */
function buildPcm(type: number, pcm: Buffer): Buffer {
	return Buffer.concat([Buffer.from([0x57, 0x41, 0x56, type]), pcm]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function render(file: Buffer): Promise<Buffer> {
	const archive = await agsPcmAudioFormat.open(sourceOf(file), "BGM01.PCM");
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("AnimeGameSystem PCM audio", () => {
	it("finds its files by three letters and a kind below ten", async () => {
		expect(agsPcmAudioFormat.descriptor.extensions).toEqual(["pcm"]);
		expect(
			await agsPcmAudioFormat.detect(sourceOf(buildPcm(0x0a, PCM)), "a.pcm"),
		).toBe(true);
		// The high nibble of the fourth byte is kept by the mask the reference applies.
		expect(
			await agsPcmAudioFormat.detect(sourceOf(buildPcm(0x1a, PCM)), "a.pcm"),
		).toBe(false);
		expect(
			await agsPcmAudioFormat.detect(
				sourceOf(Buffer.concat([Buffer.from("RIFF", "latin1"), PCM])),
				"a.pcm",
			),
		).toBe(false);
		expect(
			await agsPcmAudioFormat.detect(sourceOf(Buffer.alloc(3, 0x00)), "a.pcm"),
		).toBe(false);
		// A kind the reference knows no rate for makes its reader throw, which its own dispatch catches.
		expect(
			await agsPcmAudioFormat.detect(sourceOf(buildPcm(0x02, PCM)), "a.pcm"),
		).toBe(false);
	});

	it("wraps a kind of sixteen bits in a wave container", async () => {
		const file = buildPcm(0x0a, PCM);
		const archive = await agsPcmAudioFormat.open(sourceOf(file), "BGM01.PCM");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			// The sound begins behind the four bytes of the word.
			expect(archive.entries[0]?.size).toBe(BigInt(PCM.length));
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				sampleRate: 44100,
				channels: 1,
				bitsPerSample: 16,
			});
		} finally {
			await archive.close();
		}
		const wav = await render(file);
		expect(wav.length).toBe(PCM.length + 44);
		expect(wav.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wav.readUInt32LE(4)).toBe(PCM.length + 36);
		expect(wav.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wav.readUInt16LE(20)).toBe(1);
		expect(wav.readUInt16LE(22)).toBe(1);
		expect(wav.readUInt32LE(24)).toBe(44100);
		expect(wav.readUInt32LE(28)).toBe(88200);
		expect(wav.readUInt16LE(32)).toBe(2);
		expect(wav.readUInt16LE(34)).toBe(16);
		expect(wav.readUInt32LE(40)).toBe(PCM.length);
		// The four bytes of the word are not part of the sound.
		expect(wav.subarray(44)).toEqual(PCM);
	});

	it("takes the rate and the depth of the other kinds", async () => {
		const first = await agsPcmAudioFormat.open(
			sourceOf(buildPcm(0x06, PCM)),
			"a.pcm",
		);
		try {
			expect(first.metadata).toMatchObject({
				sampleRate: 22050,
				channels: 1,
				bitsPerSample: 16,
			});
		} finally {
			await first.close();
		}
		const eight = await agsPcmAudioFormat.open(
			sourceOf(buildPcm(0x04, PCM)),
			"b.pcm",
		);
		try {
			expect(eight.metadata).toMatchObject({
				sampleRate: 22050,
				channels: 1,
				bitsPerSample: 8,
			});
		} finally {
			await eight.close();
		}
		const wav = await render(buildPcm(0x04, PCM));
		expect(wav.readUInt32LE(24)).toBe(22050);
		expect(wav.readUInt32LE(28)).toBe(22050);
		expect(wav.readUInt16LE(32)).toBe(1);
		expect(wav.readUInt16LE(34)).toBe(8);
	});

	it("counts the channels in the low bit of the kind", async () => {
		// A kind of five is the kind of four with a second channel.
		const file = buildPcm(0x05, PCM);
		expect(await agsPcmAudioFormat.detect(sourceOf(file), "stereo.pcm")).toBe(
			true,
		);
		const archive = await agsPcmAudioFormat.open(sourceOf(file), "stereo.pcm");
		try {
			expect(archive.metadata).toMatchObject({
				sampleRate: 22050,
				channels: 2,
				bitsPerSample: 8,
			});
		} finally {
			await archive.close();
		}
		const wav = await render(file);
		expect(wav.readUInt16LE(22)).toBe(2);
		expect(wav.readUInt32LE(28)).toBe(44100);
		expect(wav.readUInt16LE(32)).toBe(2);
	});

	it("reads a sound of no bytes at all", async () => {
		const wav = await render(buildPcm(0x0a, Buffer.alloc(0)));
		expect(wav.length).toBe(44);
		expect(wav.readUInt32LE(40)).toBe(0);
	});
});
