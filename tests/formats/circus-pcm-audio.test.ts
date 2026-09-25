// The walk of the places of the file of a Circus sound, against sounds written out of the reference's own
// head and of the plain and Ogg modes it hands over.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { circusPcmAudioFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readPcmLayout } from "../../packages/formats/src/circus/pcm-audio.js";
import { readWave } from "../../packages/formats/src/shared/wav.js";

interface PcmFormat {
	formatTag?: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/** `PcmAudio.TryOpen`: the mark, the count of the places, the mode and then the head of the mode. */
function buildPcm(spec: {
	mode: number;
	extra?: number;
	body: Buffer;
	format?: PcmFormat;
}): Buffer {
	const head = Buffer.alloc(0x1c, 0);
	head.write("XPCM", 0, "latin1");
	const extra = spec.extra ?? 0;
	if (5 === spec.mode) {
		head.writeInt32LE(spec.body.length, 4);
		head.writeInt32LE(spec.mode | (extra << 8), 8);
		head.writeUInt32LE(spec.body.length, 0x0c);
		return Buffer.concat([head.subarray(0, 0x10), spec.body]);
	}
	const format = spec.format;
	if (!format) throw new Error("no format");
	head.writeInt32LE(spec.body.length, 4);
	head.writeInt32LE(spec.mode | (extra << 8), 8);
	head.writeUInt16LE(format.formatTag ?? 1, 0x0c);
	head.writeUInt16LE(format.channels, 0x0e);
	head.writeUInt32LE(format.sampleRate, 0x10);
	head.writeUInt32LE(format.averageBytesPerSecond, 0x14);
	head.writeUInt16LE(format.blockAlign, 0x18);
	head.writeUInt16LE(format.bitsPerSample, 0x1a);
	return Buffer.concat([head, spec.body]);
}

const FORMAT: PcmFormat = {
	channels: 2,
	sampleRate: 44100,
	averageBytesPerSecond: 176400,
	blockAlign: 4,
	bitsPerSample: 16,
};

async function soundOf(archive: Buffer): Promise<Buffer> {
	const handle = await circusPcmAudioFormat.open(
		new BufferByteSource(archive),
		"sample.pcm",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	return consumeBuffer(await handle.openEntry(entry.id));
}

async function nameOf(archive: Buffer): Promise<string | undefined> {
	const handle = await circusPcmAudioFormat.open(
		new BufferByteSource(archive),
		"sample.pcm",
	);
	return handle.entries[0]?.path;
}

describe("Circus PCM sound", () => {
	it("reads the head of the sound", () => {
		const layout = readPcmLayout(
			buildPcm({
				mode: 0,
				extra: 2,
				body: Buffer.alloc(8, 0x7f),
				format: FORMAT,
			}),
		);
		expect(layout?.mode).toBe(0);
		expect(layout?.extra).toBe(2);
		expect(layout?.sourceSize).toBe(8);
		expect(layout?.ogg).toBe(false);
		expect(layout?.format).toEqual({ ...FORMAT, formatTag: 1 });
	});

	it("reads a sound of the plain mode", async () => {
		const samples = Buffer.alloc(16, 0x12);
		const sound = await soundOf(
			buildPcm({ mode: 0, body: samples, format: FORMAT }),
		);
		const wave = readWave(sound);
		expect(wave?.format).toEqual({ ...FORMAT, formatTag: 1 });
		expect([
			...sound.subarray(wave?.dataOffset ?? 0, (wave?.dataOffset ?? 0) + 16),
		]).toEqual([...samples]);
		expect(
			await nameOf(buildPcm({ mode: 0, body: samples, format: FORMAT })),
		).toBe("sample.wav");
	});

	it("reads a sound of the fifth mode", async () => {
		const ogg = Buffer.from("OggS the places of the stream", "latin1");
		const sound = await soundOf(buildPcm({ mode: 5, body: ogg }));
		expect([...sound]).toEqual([...ogg]);
		expect(await nameOf(buildPcm({ mode: 5, body: ogg }))).toBe("sample.ogg");
	});

	it("refuses the packed modes of the sound", async () => {
		for (const mode of [1, 3]) {
			const archive = buildPcm({
				mode,
				body: Buffer.alloc(0x20, 0x5a),
				format: FORMAT,
			});
			expect(
				await circusPcmAudioFormat.detect(new BufferByteSource(archive)),
			).toBe(true);
			await expect(soundOf(archive)).rejects.toMatchObject({
				code: "UNSUPPORTED_FEATURE",
			});
		}
	});

	it("refuses a sound the reference cannot open", async () => {
		// A count of no places.
		const empty = buildPcm({ mode: 0, body: Buffer.alloc(0), format: FORMAT });
		empty.writeInt32LE(0, 4);
		expect(await circusPcmAudioFormat.detect(new BufferByteSource(empty))).toBe(
			false,
		);
		// A mode of the engine this port knows nothing of.
		const otherMode = buildPcm({
			mode: 2,
			body: Buffer.alloc(4),
			format: FORMAT,
		});
		expect(
			await circusPcmAudioFormat.detect(new BufferByteSource(otherMode)),
		).toBe(false);
		await expect(
			circusPcmAudioFormat.open(new BufferByteSource(otherMode), "sample.pcm"),
		).rejects.toThrow(GarbroError);
		// A mark of another engine and a file of no places at all.
		const other = Buffer.from(
			buildPcm({ mode: 0, body: Buffer.alloc(4), format: FORMAT }),
		);
		other.write("XPCM", 1, "latin1");
		expect(await circusPcmAudioFormat.detect(new BufferByteSource(other))).toBe(
			false,
		);
		expect(
			await circusPcmAudioFormat.detect(
				new BufferByteSource(Buffer.alloc(0x10)),
			),
		).toBe(false);
	});

	it("hands over a sound the file cuts short", async () => {
		const archive = buildPcm({
			mode: 0,
			body: Buffer.alloc(16, 1),
			format: FORMAT,
		});
		archive.writeInt32LE(0x1000, 4);
		const sound = await soundOf(archive);
		const wave = readWave(sound);
		expect((wave?.dataSize ?? 0) + (wave?.dataOffset ?? 0)).toBe(sound.length);
	});
});
