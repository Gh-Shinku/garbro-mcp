import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	bellDaPwAudioFormat,
	decodePw,
	PCM_TABLE,
	readPwLayout,
} from "../../packages/formats/src/bellda/pw-audio.js";

/** A wave file whose samples are one byte each, behind a `PW10` tag. */
function pwFile(
	samples: Buffer,
	options: { channels?: number; sampleRate?: number; blockAlign?: number } = {},
): Buffer {
	const channels = options.channels ?? 2;
	const sampleRate = options.sampleRate ?? 44100;
	const blockAlign = options.blockAlign ?? channels;
	const head = Buffer.alloc(0x2c);
	head.write("PW10", 0, "latin1");
	head.writeUInt32LE(head.length + samples.length - 8, 4);
	head.write("WAVE", 8, "latin1");
	head.write("fmt ", 0xc, "latin1");
	head.writeInt32LE(16, 0x10);
	head.writeUInt16LE(1, 0x14);
	head.writeUInt16LE(channels, 0x16);
	head.writeUInt32LE(sampleRate, 0x18);
	head.writeUInt32LE((sampleRate * channels * 16) / 8, 0x1c);
	head.writeUInt16LE(blockAlign, 0x20);
	head.writeUInt16LE(16, 0x22);
	head.write("data", 0x24, "latin1");
	head.writeInt32LE(samples.length, 0x28);
	return Buffer.concat([head, samples]);
}

async function extract(data: Buffer): Promise<Buffer> {
	const handle = await bellDaPwAudioFormat.open(
		new BufferByteSource(data),
		"sound.pw",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

describe("BELL-DA compressed WAVE audio", () => {
	it("reads the two chunks and doubles the block of a channel", () => {
		const layout = readPwLayout(pwFile(Buffer.from([0, 1])));
		expect(layout).toMatchObject({
			sampleOffset: 0x2c,
			sampleCount: 2,
			format: {
				formatTag: 1,
				channels: 2,
				sampleRate: 44100,
				averageBytesPerSecond: 44100 * 2 * 2,
				blockAlign: 4,
				bitsPerSample: 16,
			},
		});
	});

	it("finds a sound by its tag and the two chunks behind it", async () => {
		const data = pwFile(Buffer.from([0, 1]));
		expect(
			await bellDaPwAudioFormat.detect(new BufferByteSource(data), "sound.pw"),
		).toBe(true);
		// The tag has to stand.
		const other = Buffer.from(data);
		other.write("PW11", 0, "latin1");
		expect(readPwLayout(other)).toBeUndefined();
		// So does the samples chunk.
		const wrongChunk = Buffer.from(data);
		wrongChunk.write("datb", 0x24, "latin1");
		expect(readPwLayout(wrongChunk)).toBeUndefined();
		// And a sound whose samples are not all there.
		const short = pwFile(Buffer.from([0, 1])).subarray(0, 0x2d);
		expect(readPwLayout(short)).toBeUndefined();
	});

	it("turns every stored byte into a word of the table", () => {
		const layout = readPwLayout(pwFile(Buffer.from([0, 1, 0xff])));
		if (!layout) throw new Error("no layout");
		const pcm = decodePw(pwFile(Buffer.from([0, 1, 0xff])), layout);
		expect(pcm.readUInt16LE(0)).toBe(0x8000);
		expect(pcm.readUInt16LE(2)).toBe(0x8001);
		expect(pcm.readUInt16LE(4)).toBe(0x7fff);
		expect(PCM_TABLE.length).toBe(0x100);
		expect(PCM_TABLE[0x7f]).toBe(0xffff);
		expect(PCM_TABLE[0x80]).toBe(0x0000);
	});

	it("hands the sound out as a wave file", async () => {
		const out = await extract(pwFile(Buffer.from([0, 1, 0xff, 0x80])));
		expect(out.toString("latin1", 0, 4)).toBe("RIFF");
		expect(out.toString("latin1", 8, 12)).toBe("WAVE");
		// The samples follow the forty four byte header, sixteen bits each.
		expect(out.subarray(44, 52).toString("hex")).toBe("00800180ff7f0000");
	});

	it("reports the measurements of the sound", async () => {
		const handle = await bellDaPwAudioFormat.open(
			new BufferByteSource(pwFile(Buffer.from([0, 1]))),
			"dir/sound.pw",
		);
		expect(handle.entries[0]?.path).toBe("sound.wav");
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			formatTag: 1,
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 16,
		});
	});

	it("declines a file that does not hold a sound", async () => {
		const data = Buffer.from("PW10not a sound at all", "latin1");
		await expect(
			bellDaPwAudioFormat.open(new BufferByteSource(data), "sound.pw"),
		).rejects.toThrow(GarbroError);
		await expect(
			bellDaPwAudioFormat.open(new BufferByteSource(data), "sound.pw"),
		).rejects.toThrow("Not a BELL-DA compressed sound");
	});
});
