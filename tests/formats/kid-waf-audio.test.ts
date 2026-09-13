import { BufferByteSource } from "@garbro-mcp/core";
import { wafAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from("WAF", "latin1");
const HEADER_SIZE = 0x38;
const WAVE_HEADER_SIZE = 78;

interface Fields {
	channels?: number;
	sampleRate?: number;
	averageBytesPerSecond?: number;
	blockAlign?: number;
	bitsPerSample?: number;
	codecData?: Buffer;
	dataSize?: number;
}

const CODEC_DATA = Buffer.from(Array.from({ length: 32 }, (_, i) => 0x40 + i));

/** A WAF file: the fifty six byte header, then the codec stream. */
function buildWaf(stream: Buffer, fields: Fields = {}): Buffer {
	const header: Buffer = Buffer.alloc(HEADER_SIZE, 0x00);
	SIGNATURE.copy(header, 0);
	header.writeUInt16LE(fields.channels ?? 1, 6);
	header.writeUInt32LE(fields.sampleRate ?? 22050, 8);
	header.writeUInt32LE(fields.averageBytesPerSecond ?? 11025, 0xc);
	header.writeUInt16LE(fields.blockAlign ?? 256, 0x10);
	header.writeUInt16LE(fields.bitsPerSample ?? 4, 0x12);
	(fields.codecData ?? CODEC_DATA).copy(header, 0x14);
	header.writeInt32LE(fields.dataSize ?? stream.length, 0x34);
	return Buffer.concat([header, stream]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

async function extract(stored: Buffer, name = "SOUND.WAF"): Promise<Buffer> {
	const archive = await wafAudioFormat.open(sourceOf(stored), name);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("missing entry");
		return await consumeBuffer(await archive.openEntry(entry.id));
	} finally {
		await archive.close();
	}
}

describe("kid waf adpcm audio", () => {
	it("declares the three byte signature and no extension", () => {
		expect(wafAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(SIGNATURE.toString("latin1")).toBe("WAF");
		expect(wafAudioFormat.descriptor.extensions).toEqual([]);
	});

	it("wraps the codec stream in a wave whose header it writes itself", async () => {
		const stream = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const stored = buildWaf(stream);
		const source = sourceOf(stored);
		expect(await wafAudioFormat.detect(source, "SOUND.WAF")).toBe(true);
		const archive = await wafAudioFormat.open(source, "SOUND.WAF");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["SOUND.wav"]);
			expect(archive.entries[0]?.sizeKnown).toBe(false);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				formatTag: 2,
				channels: 1,
				sampleRate: 22050,
				blockAlign: 256,
				bitsPerSample: 4,
			});
		} finally {
			await archive.close();
		}
		const output = await extract(stored);
		expect(output.length).toBe(WAVE_HEADER_SIZE + stream.length);
		expect(output.toString("latin1", 0, 4)).toBe("RIFF");
		// The size word covers the header after it plus the declared stream, which here is all of it.
		expect(output.readUInt32LE(4)).toBe(WAVE_HEADER_SIZE - 8 + stream.length);
		expect(output.toString("latin1", 8, 12)).toBe("WAVE");
		expect(output.toString("latin1", 12, 16)).toBe("fmt ");
		// Fifty bytes: the sixteen byte payload, the extra size word and its thirty two bytes.
		expect(output.readUInt32LE(16)).toBe(0x32);
		expect(output.readUInt16LE(20)).toBe(2);
		expect(output.readUInt16LE(22)).toBe(1);
		expect(output.readUInt32LE(24)).toBe(22050);
		expect(output.readUInt32LE(28)).toBe(11025);
		expect(output.readUInt16LE(32)).toBe(256);
		expect(output.readUInt16LE(34)).toBe(4);
		expect(output.readUInt16LE(36)).toBe(0x20);
		expect(output.subarray(38, 70)).toEqual(CODEC_DATA);
		expect(output.toString("latin1", 70, 74)).toBe("data");
		expect(output.readUInt32LE(74)).toBe(stream.length);
		expect(output.subarray(WAVE_HEADER_SIZE)).toEqual(stream);
	});

	it("carries the codec coefficients through as they stand", async () => {
		const codecData = Buffer.from(
			Array.from({ length: 32 }, (_, i) => 0xff - i),
		);
		const stream = Buffer.from([0xaa]);
		const stored = buildWaf(stream, { codecData });
		const output = await extract(stored);
		expect(output.subarray(38, 70)).toEqual(codecData);
		expect(output.subarray(38, 70)).not.toEqual(CODEC_DATA);
	});

	it("reports the declared size even when the file is shorter, and keeps trailing bytes", async () => {
		// The reference performs no check on the size word: the wave's data chunk is as long as the word says,
		// while the bytes after the header are everything to the end of the file.
		const stream = Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]);
		const stored = buildWaf(stream, { dataSize: 100 });
		const output = await extract(stored);
		expect(output.readUInt32LE(74)).toBe(100);
		expect(output.subarray(WAVE_HEADER_SIZE)).toEqual(stream);
		// The size word of the file counts the short stream, not the declared one.
		expect(output.readUInt32LE(4)).toBe(WAVE_HEADER_SIZE - 8 + 100);
	});

	it("accepts a zero length stream", async () => {
		const stored = buildWaf(Buffer.alloc(0));
		expect(await wafAudioFormat.detect(sourceOf(stored), "SOUND.WAF")).toBe(
			true,
		);
		const output = await extract(stored);
		expect(output.length).toBe(WAVE_HEADER_SIZE);
		expect(output.readUInt32LE(74)).toBe(0);
		expect(output.readUInt32LE(4)).toBe(WAVE_HEADER_SIZE - 8);
	});

	it("declines a short file and a wrong signature", async () => {
		expect(
			await wafAudioFormat.detect(
				sourceOf(Buffer.alloc(HEADER_SIZE - 1)),
				"SOUND.WAF",
			),
		).toBe(false);
		const stored = buildWaf(Buffer.alloc(4, 0x11));
		stored[0] = 0x00;
		expect(await wafAudioFormat.detect(sourceOf(stored), "SOUND.WAF")).toBe(
			false,
		);
	});
});
