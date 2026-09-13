import { BufferByteSource } from "@garbro-mcp/core";
import { wazAudioDescriptor, wazAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0xff, 0x52, 0x49, 0x46]);
const RIFF_HEADER_SIZE = 44;
/** Deliberately inconsistent: two channels with a six byte block align and eight bit samples. */
const FORMAT = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 44100,
	blockAlign: 6,
	bitsPerSample: 8,
};

/** The codec's control byte: one per eight items, a set bit meaning a literal byte. */
function lzssLiterals(data: Buffer): Buffer {
	const parts: Buffer[] = [];
	for (let i = 0; i < data.length; i += 8) {
		const chunk = data.subarray(i, Math.min(i + 8, data.length));
		parts.push(Buffer.from([0xff]), chunk);
	}
	return Buffer.concat(parts);
}

interface Chunk {
	id: string;
	body: Buffer;
}

/** A wave file from raw chunks, with the `RIFF` size recomputed. */
function buildWave(chunks: Chunk[]): Buffer {
	const parts: Buffer[] = [];
	for (const chunk of chunks) {
		const head: Buffer = Buffer.alloc(8);
		head.write(chunk.id, 0, "latin1");
		head.writeUInt32LE(chunk.body.length, 4);
		const padding: Buffer = Buffer.alloc(chunk.body.length & 1);
		parts.push(head, chunk.body, padding);
	}
	const body: Buffer = Buffer.concat(parts);
	const head: Buffer = Buffer.alloc(12);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(body.length + 4, 4);
	head.write("WAVE", 8, "latin1");
	return Buffer.concat([head, body]);
}

function formatChunk(): Buffer {
	const body: Buffer = Buffer.alloc(16);
	body.writeUInt16LE(FORMAT.formatTag, 0);
	body.writeUInt16LE(FORMAT.channels, 2);
	body.writeUInt32LE(FORMAT.sampleRate, 4);
	body.writeUInt32LE(FORMAT.averageBytesPerSecond, 8);
	body.writeUInt16LE(FORMAT.blockAlign, 12);
	body.writeUInt16LE(FORMAT.bitsPerSample, 14);
	return body;
}

function buildPcm(size = 0x20): Buffer {
	const pcm: Buffer = Buffer.alloc(size);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 7) & 0xff;
	return pcm;
}

/** The canonical wave file the port is expected to write. */
function expectedWave(pcm: Buffer): Buffer {
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	riff.writeUInt16LE(FORMAT.formatTag, 20);
	riff.writeUInt16LE(FORMAT.channels, 22);
	riff.writeUInt32LE(FORMAT.sampleRate, 24);
	riff.writeUInt32LE(FORMAT.averageBytesPerSecond, 28);
	riff.writeUInt16LE(FORMAT.blockAlign, 32);
	riff.writeUInt16LE(FORMAT.bitsPerSample, 34);
	riff.write("data", 36, "latin1");
	riff.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([riff, pcm]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("anotherroom waz audio", () => {
	it("declares the signature that the lzss stream starts with", () => {
		expect(wazAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		expect(wazAudioDescriptor.extensions).toEqual(["waz"]);
	});

	it("decompresses the wave file and reserialises it", async () => {
		const pcm = buildPcm();
		const stored = lzssLiterals(
			buildWave([
				{ id: "fmt ", body: formatChunk() },
				{ id: "data", body: pcm },
			]),
		);
		// The stream begins with a literal control byte, then the wave file's own `RIF`.
		expect(stored.subarray(0, 4)).toEqual(SIGNATURE);
		const source = sourceOf(stored);
		expect(await wazAudioFormat.detect(source, "BGM01.WAZ")).toBe(true);
		const archive = await wazAudioFormat.open(source, "BGM01.WAZ");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				compression: "lzss",
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			expect(archive.entries[0]?.size).toBe(BigInt(stored.length));
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(expectedWave(pcm));
			// The inconsistent fields survive, so nothing was recomputed.
			expect(output.readUInt16LE(32)).toBe(6);
		} finally {
			await archive.close();
		}
	});

	it("drops chunks other than fmt and data", async () => {
		const pcm = buildPcm(0x10);
		const stored = lzssLiterals(
			buildWave([
				{ id: "fmt ", body: formatChunk() },
				{ id: "LIST", body: Buffer.alloc(6, 0x41) },
				{ id: "data", body: pcm },
			]),
		);
		const archive = await wazAudioFormat.open(sourceOf(stored), "BGM02.WAZ");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(expectedWave(pcm));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 0x10);
		} finally {
			await archive.close();
		}
	});

	it("shortens a data chunk that reaches past the stream", async () => {
		const pcm = buildPcm(8);
		const wave = buildWave([
			{ id: "fmt ", body: formatChunk() },
			{ id: "data", body: pcm },
		]);
		// Claim more data than the file holds, which is how a region behaves.
		wave.writeUInt32LE(0x40, wave.length - pcm.length - 4);
		const archive = await wazAudioFormat.open(
			sourceOf(lzssLiterals(wave)),
			"BGM03.WAZ",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(RIFF_HEADER_SIZE + 8);
			expect(output.subarray(RIFF_HEADER_SIZE)).toEqual(pcm);
		} finally {
			await archive.close();
		}
	});

	it("declines a stream that does not decompress to a wave file", async () => {
		const stored = lzssLiterals(Buffer.alloc(0x40, 0x42));
		expect(await wazAudioFormat.detect(sourceOf(stored), "BGM01.WAZ")).toBe(
			false,
		);
	});

	it("declines a wave file without a fmt chunk", async () => {
		const stored = lzssLiterals(buildWave([{ id: "data", body: buildPcm(8) }]));
		expect(await wazAudioFormat.detect(sourceOf(stored), "BGM01.WAZ")).toBe(
			false,
		);
	});

	it("declines a plain uncompressed wave file", async () => {
		const stored = buildWave([
			{ id: "fmt ", body: formatChunk() },
			{ id: "data", body: buildPcm(8) },
		]);
		// The bytes happen to start with the signature only for a compressed stream.
		expect(await wazAudioFormat.detect(sourceOf(stored), "BGM01.WAZ")).toBe(
			false,
		);
	});

	it("declines a file shorter than the signature", async () => {
		expect(
			await wazAudioFormat.detect(
				sourceOf(SIGNATURE.subarray(0, 3)),
				"BGM01.WAZ",
			),
		).toBe(false);
	});
});
