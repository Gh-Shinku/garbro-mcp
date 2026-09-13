import { BufferByteSource } from "@garbro-mcp/core";
import { wrgAudioFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

const SIGNATURE = Buffer.from([0xad, 0xb6, 0xb9, 0xb9]);
const RIFF_HEADER_SIZE = 44;

interface Format {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/** Deliberately inconsistent, so the test shows the fields are copied rather than recomputed. */
const FORMAT: Format = {
	formatTag: 1,
	channels: 2,
	sampleRate: 22050,
	averageBytesPerSecond: 44100,
	blockAlign: 6,
	bitsPerSample: 8,
};

function formatChunk(format: Format = FORMAT): Buffer {
	const body: Buffer = Buffer.alloc(16);
	body.writeUInt16LE(format.formatTag, 0);
	body.writeUInt16LE(format.channels, 2);
	body.writeUInt32LE(format.sampleRate, 4);
	body.writeUInt32LE(format.averageBytesPerSecond, 8);
	body.writeUInt16LE(format.blockAlign, 12);
	body.writeUInt16LE(format.bitsPerSample, 14);
	return body;
}

function buildWave(
	pcmSize = 0x20,
	withList = false,
): { wave: Buffer; pcm: Buffer } {
	const pcm: Buffer = Buffer.alloc(pcmSize);
	for (let i = 0; i < pcm.length; i += 1) pcm[i] = (i * 23) & 0xff;
	// Every chunk carries an eight byte header: an identifier and a size. The first version of this
	// fixture wrote the `fmt ` identifier without its size, so the parser read the format fields as a
	// huge chunk length and never reached the data chunk.
	const fmtHead: Buffer = Buffer.alloc(8);
	fmtHead.write("fmt ", 0, "latin1");
	fmtHead.writeUInt32LE(16, 4);
	const chunks: Buffer[] = [fmtHead, formatChunk()];
	if (withList) {
		const list: Buffer = Buffer.alloc(8);
		list.write("LIST", 0, "latin1");
		list.writeUInt32LE(4, 4);
		chunks.push(list, Buffer.alloc(4, 0x41));
	}
	const dataHead: Buffer = Buffer.alloc(8);
	dataHead.write("data", 0, "latin1");
	dataHead.writeUInt32LE(pcm.length, 4);
	chunks.push(dataHead, pcm);
	const body = Buffer.concat(chunks);
	const head: Buffer = Buffer.alloc(12);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(body.length + 4, 4);
	head.write("WAVE", 8, "latin1");
	return { wave: Buffer.concat([head, body]), pcm };
}

function scramble(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ 0xff;
	return output;
}

function expectedWave(pcm: Buffer, format: Format = FORMAT): Buffer {
	const riff: Buffer = Buffer.alloc(RIFF_HEADER_SIZE);
	riff.write("RIFF", 0, "latin1");
	riff.writeUInt32LE(RIFF_HEADER_SIZE - 8 + pcm.length, 4);
	riff.write("WAVE", 8, "latin1");
	riff.write("fmt ", 12, "latin1");
	riff.writeUInt32LE(16, 16);
	riff.writeUInt16LE(format.formatTag, 20);
	riff.writeUInt16LE(format.channels, 22);
	riff.writeUInt32LE(format.sampleRate, 24);
	riff.writeUInt32LE(format.averageBytesPerSecond, 28);
	riff.writeUInt16LE(format.blockAlign, 32);
	riff.writeUInt16LE(format.bitsPerSample, 34);
	riff.write("data", 36, "latin1");
	riff.writeUInt32LE(pcm.length, 40);
	return Buffer.concat([riff, pcm]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("regrips wrg audio", () => {
	it("declares the inverted RIFF signature", () => {
		expect(wrgAudioFormat.detection?.signatures).toEqual([
			{ bytes: SIGNATURE },
		]);
		// The stored signature is `RIFF` with every byte inverted.
		expect(
			Buffer.from(SIGNATURE.map((byte) => byte ^ 0xff)).toString("latin1"),
		).toBe("RIFF");
	});

	it("restores the wave file and reserialises it", async () => {
		const { wave, pcm } = buildWave();
		const stored = scramble(wave);
		const source = sourceOf(stored);
		expect(await wrgAudioFormat.detect(source, "BGM01.WRG")).toBe(true);
		const archive = await wrgAudioFormat.open(source, "BGM01.WRG");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["BGM01.wav"]);
			expect(archive.entries[0]?.metadata).toMatchObject({ type: "audio" });
			expect(archive.entries[0]?.encrypted).toBe(true);
			expect(archive.metadata).toMatchObject({
				audio: "wav",
				encrypted: true,
				channels: 2,
				sampleRate: 22050,
				bitsPerSample: 8,
			});
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.size).toBe(BigInt(stored.length));
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(expectedWave(pcm));
			// The inconsistent fields survive, so nothing was recomputed.
			expect(output.readUInt16LE(32)).toBe(6);
		} finally {
			await archive.close();
		}
	});

	it("drops chunks other than fmt and data", async () => {
		const { wave, pcm } = buildWave(0x10, true);
		const archive = await wrgAudioFormat.open(
			sourceOf(scramble(wave)),
			"BGM02.WRG",
		);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output).toEqual(expectedWave(pcm));
		} finally {
			await archive.close();
		}
	});

	it("declines a plain wave file", async () => {
		const { wave } = buildWave();
		// An unscrambled file begins with `RIFF`, which is not this format's signature.
		expect(await wrgAudioFormat.detect(sourceOf(wave), "BGM01.WRG")).toBe(
			false,
		);
	});

	it("declines a scrambled stream that is not a wave file", async () => {
		const stored = scramble(Buffer.alloc(0x40, 0x42));
		expect(await wrgAudioFormat.detect(sourceOf(stored), "BGM01.WRG")).toBe(
			false,
		);
	});

	it("declines a truncated stream", async () => {
		const { wave } = buildWave();
		expect(
			await wrgAudioFormat.detect(
				sourceOf(scramble(wave).subarray(0, 20)),
				"BGM01.WRG",
			),
		).toBe(false);
	});

	it("declines a file shorter than the signature", async () => {
		expect(
			await wrgAudioFormat.detect(
				sourceOf(SIGNATURE.subarray(0, 3)),
				"BGM01.WRG",
			),
		).toBe(false);
	});
});
