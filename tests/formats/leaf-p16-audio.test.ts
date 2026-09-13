import { BufferByteSource } from "@garbro-mcp/core";
import { leafP16AudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const PCM = Buffer.alloc(0x40);
for (let i = 0; i < PCM.length; i += 1) PCM[i] = (i * 7) & 0xff;

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("leaf p16 audio", () => {
	it("wraps the raw pcm stream in a wave container", async () => {
		const source = sourceOf(PCM);
		expect(await leafP16AudioFormat.detect(source, "VOICE.P16")).toBe(true);
		const archive = await leafP16AudioFormat.open(source, "VOICE.P16");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["VOICE.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				sampleRate: 44100,
				channels: 1,
				bitsPerSample: 16,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(PCM.length + 44);
			expect(output.subarray(0, 4).toString("latin1")).toBe("RIFF");
			expect(output.readUInt32LE(4)).toBe(PCM.length + 36);
			expect(output.subarray(8, 12).toString("latin1")).toBe("WAVE");
			expect(output.readUInt16LE(20)).toBe(1);
			expect(output.readUInt16LE(22)).toBe(1);
			expect(output.readUInt32LE(24)).toBe(44100);
			expect(output.readUInt32LE(28)).toBe(88200);
			expect(output.readUInt16LE(32)).toBe(2);
			expect(output.readUInt16LE(34)).toBe(16);
			expect(output.readUInt32LE(40)).toBe(PCM.length);
			expect(output.subarray(44)).toEqual(PCM);
		} finally {
			await archive.close();
		}
	});

	it("accepts the extension in any case", async () => {
		expect(
			await leafP16AudioFormat.detect(sourceOf(PCM), "/games/DATA/voice.p16"),
		).toBe(true);
	});

	it("declines another extension", async () => {
		expect(await leafP16AudioFormat.detect(sourceOf(PCM), "VOICE.PCM")).toBe(
			false,
		);
	});

	it("declines an empty file", async () => {
		expect(
			await leafP16AudioFormat.detect(sourceOf(Buffer.alloc(0)), "V.P16"),
		).toBe(false);
	});
});
