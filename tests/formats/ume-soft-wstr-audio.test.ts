import { BufferByteSource } from "@garbro-mcp/core";
import { wstrAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x20;
const PCM = Buffer.alloc(0x60, 0x27);

/** Builds a container: the signature, the format fields and the raw pcm stream. */
function buildStr(
	format = { channels: 2, sampleRate: 44100, bitsPerSample: 16 },
): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x2a);
	head.write("WSTR", 0, "latin1");
	head.writeUInt16LE(format.channels, 4);
	head.writeUInt16LE(format.bitsPerSample, 6);
	head.writeUInt32LE(format.sampleRate, 8);
	return Buffer.concat([head, PCM]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("ume soft wstr audio", () => {
	it("declares the WSTR signature for the registry", () => {
		expect(wstrAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("WSTR", "latin1") },
		]);
	});

	it("wraps the raw pcm stream in a wave container", async () => {
		const source = sourceOf(buildStr());
		expect(await wstrAudioFormat.detect(source, "VOICE01.STR")).toBe(true);
		const archive = await wstrAudioFormat.open(source, "VOICE01.STR");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"VOICE01.wav",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				sampleRate: 44100,
				channels: 2,
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
			expect(output.readUInt16LE(22)).toBe(2);
			expect(output.readUInt32LE(24)).toBe(44100);
			expect(output.readUInt32LE(28)).toBe(176400);
			expect(output.readUInt16LE(32)).toBe(4);
			expect(output.readUInt16LE(34)).toBe(16);
			expect(output.readUInt32LE(40)).toBe(PCM.length);
			expect(output.subarray(44)).toEqual(PCM);
		} finally {
			await archive.close();
		}
	});

	it("honours mono eight bit headers", async () => {
		const source = sourceOf(
			buildStr({ channels: 1, sampleRate: 11025, bitsPerSample: 8 }),
		);
		const archive = await wstrAudioFormat.open(source, "VOICE02.STR");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(22)).toBe(1);
			expect(output.readUInt32LE(24)).toBe(11025);
			expect(output.readUInt32LE(28)).toBe(11025);
			expect(output.readUInt16LE(32)).toBe(1);
			expect(output.readUInt16LE(34)).toBe(8);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const file = buildStr();
		file.write("WSXR", 0, "latin1");
		expect(await wstrAudioFormat.detect(sourceOf(file), "VOICE01.STR")).toBe(
			false,
		);
	});

	it("declines zero channels", async () => {
		const file = buildStr({
			channels: 0,
			sampleRate: 44100,
			bitsPerSample: 16,
		});
		expect(await wstrAudioFormat.detect(sourceOf(file), "VOICE01.STR")).toBe(
			false,
		);
	});

	it("declines an unsupported bit depth", async () => {
		const file = buildStr({
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 12,
		});
		expect(await wstrAudioFormat.detect(sourceOf(file), "VOICE01.STR")).toBe(
			false,
		);
	});

	it("declines a file without room for a stream", async () => {
		expect(
			await wstrAudioFormat.detect(
				sourceOf(buildStr().subarray(0, HEADER_SIZE)),
				"VOICE01.STR",
			),
		).toBe(false);
	});
});
