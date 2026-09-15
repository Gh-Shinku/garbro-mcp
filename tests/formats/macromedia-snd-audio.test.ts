import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { macromediaSndAudioFormat } from "../../packages/formats/src/macromedia/snd-audio.js";

const SAMPLE_RATE = 11025;

interface SndParts {
	type?: number;
	count?: number;
	command?: number;
	position?: number;
	frequency?: number;
	encoding?: number;
	param: number;
	/** The depth and the sample count of the other encoding. */
	frames?: number;
	depth?: number;
	samples: Buffer;
}

function sndFile(parts: SndParts): Buffer {
	const encoding = parts.encoding ?? 0x00;
	const head: Buffer = Buffer.alloc(0xff === encoding ? 0x4e : 0x24, 0);
	head.writeUInt16LE(parts.type ?? 0x0200, 0);
	head.writeUInt16BE(parts.count ?? 1, 4);
	head.writeUInt16BE(parts.command ?? 0x8051, 6);
	head.writeInt32BE(parts.position ?? 14, 10);
	head.writeInt32BE(parts.param, 18);
	head.writeUInt16BE(SAMPLE_RATE, 22);
	head[34] = encoding;
	head[35] = parts.frequency ?? 0x3c;
	if (0xff === encoding) {
		head.writeInt32BE(parts.frames ?? 0, 36);
		head.writeUInt16BE(parts.depth ?? 8, 62);
	}
	return Buffer.concat([head, parts.samples]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function open(
	data: Buffer,
	sourcePath = "cs.snd",
): Promise<Awaited<ReturnType<typeof macromediaSndAudioFormat.open>>> {
	return macromediaSndAudioFormat.open(sourceOf(data), sourcePath);
}

async function extract(
	handle: Awaited<ReturnType<typeof macromediaSndAudioFormat.open>>,
): Promise<Buffer> {
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("Macromedia Director audio resource", () => {
	it("finds a sound by the name of its file", async () => {
		const data = sndFile({ param: 4, samples: Buffer.alloc(8, 0x40) });
		expect(
			await macromediaSndAudioFormat.detect(sourceOf(data), "cs.snd"),
		).toBe(true);
		expect(
			await macromediaSndAudioFormat.detect(sourceOf(data), "cs.dat"),
		).toBe(false);
	});

	it("declines a header the reference does not read", async () => {
		const parts: SndParts = { param: 4, samples: Buffer.alloc(8, 0x40) };
		for (const broken of [
			{ ...parts, type: 0x0201 },
			{ ...parts, count: 0 },
			{ ...parts, command: 0x8050 },
			{ ...parts, position: 0x12 },
			{ ...parts, frequency: 0x3d },
			{ ...parts, encoding: 0x02 },
			{ ...parts, encoding: 0xff, depth: 12 },
		]) {
			const data = sndFile(broken);
			expect(
				await macromediaSndAudioFormat.detect(sourceOf(data), "cs.snd"),
			).toBe(false);
		}
	});

	it("reports the sound behind the header", async () => {
		const data = sndFile({ param: 4, samples: Buffer.alloc(8, 0x40) });
		const handle = await open(data, "dir/cs.snd");
		expect(handle.entries[0]?.path).toBe("cs.wav");
		expect(handle.entries[0]?.size).toBe(BigInt(data.length - 0x24));
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			channels: 1,
			sampleRate: SAMPLE_RATE,
			bitsPerSample: 8,
		});
	});

	it("wraps a stream of eight bit samples as it stands", async () => {
		const samples: Buffer = Buffer.alloc(8, 0);
		for (let index = 0; index < samples.length; index += 1) {
			samples[index] = 0x80 + index;
		}
		const out = await extract(await open(sndFile({ param: 8, samples })));
		expect(out.subarray(0, 12).toString("latin1")).toBe("RIFF,\0\0\0WAVE");
		expect(out.readUInt16LE(0x14)).toBe(1);
		expect(out.readUInt16LE(0x16)).toBe(1);
		expect(out.readUInt32LE(0x18)).toBe(SAMPLE_RATE);
		expect(out.readUInt32LE(0x1c)).toBe(SAMPLE_RATE);
		expect(out.readUInt16LE(0x20)).toBe(1);
		expect(out.readUInt16LE(0x22)).toBe(8);
		expect(out.readUInt32LE(0x28)).toBe(8);
		expect(out.subarray(0x2c)).toEqual(samples);
	});

	it("turns the pairs of a sixteen bit stream around, one byte to a sample", async () => {
		// The reference asks for as many bytes as the header declares samples, not twice as many, so only the
		// first four bytes of this stream are taken — and every pair of them is turned around.
		const samples: Buffer = Buffer.from([
			0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08,
		]);
		const data = sndFile({
			param: 1,
			encoding: 0xff,
			frames: 4,
			depth: 16,
			samples,
		});
		const handle = await open(data);
		// The stream of samples of that encoding stands six words behind the fields of the header.
		expect(handle.entries[0]?.size).toBe(BigInt(data.length - 0x4e));
		expect(handle.metadata).toMatchObject({ bitsPerSample: 16, channels: 1 });
		const out = await extract(handle);
		expect(out.readUInt32LE(0x28)).toBe(4);
		expect(out.subarray(0x2c).toString("hex")).toBe("02010403");
	});

	it("keeps the block alignment one sample wide however many channels there are", async () => {
		const data = sndFile({
			param: 2,
			encoding: 0xff,
			frames: 2,
			depth: 16,
			samples: Buffer.from([0x01, 0x02, 0x03, 0x04]),
		});
		const handle = await open(data);
		expect(handle.metadata).toMatchObject({ channels: 2, bitsPerSample: 16 });
		const out = await extract(handle);
		// The reference sets the alignment to the depth in bytes, not to a frame of the sound.
		expect(out.readUInt16LE(0x20)).toBe(2);
		expect(out.readUInt32LE(0x1c)).toBe((SAMPLE_RATE * 2 * 16) / 8);
	});

	it("takes what a sixteen bit stream actually holds when it is cut short", async () => {
		const data = sndFile({
			param: 1,
			encoding: 0xff,
			frames: 100,
			depth: 16,
			samples: Buffer.from([0x01, 0x02, 0x03, 0x04, 0x05, 0x06]),
		});
		const out = await extract(await open(data));
		expect(out.readUInt32LE(0x28)).toBe(6);
		expect(out.subarray(0x2c).toString("hex")).toBe("020104030605");
	});

	it("hands out a stream of MPEG Layer 3 when that is what the samples are", async () => {
		const samples: Buffer = Buffer.concat([
			Buffer.from([0xff, 0xe2, 0x90, 0x00]),
			Buffer.alloc(32, 0x11),
		]);
		const data = sndFile({ param: 36, samples });
		const handle = await open(data, "cs.snd");
		expect(handle.entries[0]?.path).toBe("cs.mp3");
		expect(handle.metadata).toMatchObject({ audio: "mp3" });
		expect(await extract(handle)).toEqual(samples);
	});
});
