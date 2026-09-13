import { BufferByteSource } from "@garbro-mcp/core";
import { kwfAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const HEADER_SIZE = 0x40;
const PCM = Buffer.alloc(0x50, 0x37);

interface Format {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/** Deliberately inconsistent with the channel count, to show the fields are copied verbatim. */
const FORMAT: Format = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 88200,
	blockAlign: 4,
	bitsPerSample: 16,
};

/** Builds a container: the signature, the method and the wave format block. */
function buildKwf(
	method = 3,
	format: Format = FORMAT,
	stream: Buffer = PCM,
): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x2a);
	head.write("KWF0", 0, "latin1");
	head.writeInt32LE(method, 4);
	head.writeUInt16LE(format.formatTag, 0x28);
	head.writeUInt16LE(format.channels, 0x2a);
	head.writeUInt32LE(format.sampleRate, 0x2c);
	head.writeUInt32LE(format.averageBytesPerSecond, 0x30);
	head.writeUInt16LE(format.blockAlign, 0x34);
	head.writeUInt16LE(format.bitsPerSample, 0x36);
	return Buffer.concat([head, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("dice kwf audio", () => {
	it("declares the KWF0 signature for the registry", () => {
		expect(kwfAudioFormat.detection?.signatures).toEqual([
			{ bytes: Buffer.from("KWF0", "latin1") },
		]);
	});

	it("wraps the pcm stream with the header format", async () => {
		const source = sourceOf(buildKwf());
		expect(await kwfAudioFormat.detect(source, "VOICE01.KWF")).toBe(true);
		const archive = await kwfAudioFormat.open(source, "VOICE01.KWF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"VOICE01.wav",
			]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "pcm",
				sampleRate: 22050,
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
			expect(output.readUInt32LE(24)).toBe(22050);
			// Copied from the header, not recomputed from the channel count.
			expect(output.readUInt32LE(28)).toBe(88200);
			expect(output.readUInt16LE(32)).toBe(4);
			expect(output.readUInt16LE(34)).toBe(16);
			expect(output.readUInt32LE(40)).toBe(PCM.length);
			expect(output.subarray(44)).toEqual(PCM);
		} finally {
			await archive.close();
		}
	});

	it("declines an unimplemented method", async () => {
		const file = buildKwf(2);
		expect(await kwfAudioFormat.detect(sourceOf(file), "VOICE01.KWF")).toBe(
			false,
		);
	});

	it("declines a file without the signature", async () => {
		const file = buildKwf();
		file.write("KWFX", 0, "latin1");
		expect(await kwfAudioFormat.detect(sourceOf(file), "VOICE01.KWF")).toBe(
			false,
		);
	});

	it("declines a file without room for a stream", async () => {
		expect(
			await kwfAudioFormat.detect(
				sourceOf(buildKwf(3, FORMAT, Buffer.alloc(0))),
				"VOICE01.KWF",
			),
		).toBe(false);
	});
});
