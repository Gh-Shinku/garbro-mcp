import { BufferByteSource } from "@garbro-mcp/core";
import { esdAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x20;
const PCM = Buffer.alloc(0x50, 0x19);

/** Builds a container: the signature, the format fields and the raw pcm stream. */
function buildEsd(
	format = { channels: 1, sampleRate: 22050, bitsPerSample: 16 },
): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x2a);
	head.write("ESD ", 0, "latin1");
	head.writeUInt32LE(format.sampleRate, 8);
	head.writeUInt16LE(format.bitsPerSample, 0xc);
	head.writeUInt16LE(format.channels, 0x10);
	return Buffer.concat([head, PCM]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("tamasoft esd audio", () => {
	it("declares the ESD signature for the registry", () => {
		expect(esdAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("ESD ", "latin1") },
		]);
	});

	it("wraps the raw pcm stream in a wave container", async () => {
		const source = sourceOf(buildEsd());
		expect(await esdAudioFormat.detect(source, "SE01.ESD")).toBe(true);
		const archive = await esdAudioFormat.open(source, "SE01.ESD");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SE01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				sampleRate: 22050,
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
			expect(output.readUInt32LE(24)).toBe(22050);
			expect(output.readUInt32LE(28)).toBe(44100);
			expect(output.readUInt16LE(32)).toBe(2);
			expect(output.readUInt16LE(34)).toBe(16);
			expect(output.readUInt32LE(40)).toBe(PCM.length);
			expect(output.subarray(44)).toEqual(PCM);
		} finally {
			await archive.close();
		}
	});

	it("honours stereo eight bit headers", async () => {
		const source = sourceOf(
			buildEsd({ channels: 2, sampleRate: 8000, bitsPerSample: 8 }),
		);
		const archive = await esdAudioFormat.open(source, "SE02.ESD");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.readUInt16LE(22)).toBe(2);
			expect(output.readUInt32LE(24)).toBe(8000);
			expect(output.readUInt32LE(28)).toBe(16000);
			expect(output.readUInt16LE(32)).toBe(2);
			expect(output.readUInt16LE(34)).toBe(8);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the signature", async () => {
		const file = buildEsd();
		file.write("ESX ", 0, "latin1");
		expect(await esdAudioFormat.detect(sourceOf(file), "SE01.ESD")).toBe(false);
	});

	it("declines a zero sample rate", async () => {
		const file = buildEsd({ channels: 1, sampleRate: 0, bitsPerSample: 16 });
		expect(await esdAudioFormat.detect(sourceOf(file), "SE01.ESD")).toBe(false);
	});

	it("declines an unsupported bit depth", async () => {
		const file = buildEsd({
			channels: 1,
			sampleRate: 22050,
			bitsPerSample: 12,
		});
		expect(await esdAudioFormat.detect(sourceOf(file), "SE01.ESD")).toBe(false);
	});

	it("declines a file without room for a stream", async () => {
		expect(
			await esdAudioFormat.detect(
				sourceOf(buildEsd().subarray(0, HEADER_SIZE)),
				"SE01.ESD",
			),
		).toBe(false);
	});
});
