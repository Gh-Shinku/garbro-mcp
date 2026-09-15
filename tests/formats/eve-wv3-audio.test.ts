import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	decodeWv3,
	eveWv3AudioFormat,
	readWv3Layout,
} from "../../packages/formats/src/eve/wv3-audio.js";

const HEADER_SIZE = 0x26;
const BLOCK_SIZE = 72;
const BLOCK_BYTES = 280;
const SAMPLES_PER_CHANNEL = 35;
const PCM_OFFSET = 0x2c;

/** A block of the stream: the two bytes of the channels and the four-bit samples behind them. */
function block(
	channelBytes: [number, number],
	samples: [number[], number[]],
): Buffer {
	const out: Buffer = Buffer.alloc(BLOCK_SIZE, 0x00);
	out[0] = channelBytes[0] & 0xff;
	out[1] = channelBytes[1] & 0xff;
	for (let channel = 0; channel < 2; channel += 1) {
		for (let index = 0; index < SAMPLES_PER_CHANNEL; index += 1) {
			const run = samples[channel] ?? [];
			const low = (run[index * 2] ?? 0) & 0x0f;
			const high = (run[index * 2 + 1] ?? 0) & 0x0f;
			out[SAMPLES_PER_CHANNEL * channel + 2 + index] = (high << 4) | low;
		}
	}
	return out;
}

/** A whole file: the header and the blocks behind it. */
function wv3File(
	blocks: Buffer[],
	parts: {
		sampleRate?: number;
		dataOffset?: number;
		declaredBlocks?: number;
	} = {},
): Buffer {
	const dataOffset = parts.dataOffset ?? HEADER_SIZE;
	const head: Buffer = Buffer.alloc(Math.max(dataOffset, HEADER_SIZE), 0x00);
	head.write("WV3.", 0, "latin1");
	head[4] = 0x30;
	head.writeUInt32LE(dataOffset, 6);
	head.writeUInt32LE(parts.sampleRate ?? 22050, 0x0e);
	head.writeInt32LE(parts.declaredBlocks ?? blocks.length, 0x1a);
	return Buffer.concat([head, ...blocks]);
}

function sourceOf(data: Buffer): BufferByteSource {
	return new BufferByteSource(data);
}

async function extract(data: Buffer, sourcePath = "bgm.wv3"): Promise<Buffer> {
	const handle = await eveWv3AudioFormat.open(sourceOf(data), sourcePath);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const chunks: Buffer[] = [];
	for await (const chunk of await handle.openEntry(entry.id)) {
		chunks.push(Buffer.from(chunk));
	}
	return Buffer.concat(chunks);
}

/** The samples of a block of the sound, sixteen bits each, in the order the sound keeps them. */
function sampleRun(pcm: Buffer, from = 0): number[] {
	const out: number[] = [];
	for (let at = from; at + 1 < pcm.length; at += 2) {
		out.push(pcm.readInt16LE(at));
	}
	return out;
}

describe("Eve compressed sound format", () => {
	it("finds a sound by its four bytes and the letter behind them", async () => {
		const data = wv3File([block([0, 0], [[1], [2]])]);
		expect(await eveWv3AudioFormat.detect(sourceOf(data), "bgm.wv3")).toBe(
			true,
		);
		// The letter behind the four bytes has to stand at `0`, and the sound has to hold a block.
		const odd = Buffer.from(data);
		odd[4] = 0x31;
		expect(readWv3Layout(odd)).toBeUndefined();
		expect(readWv3Layout(wv3File([], { declaredBlocks: 0 }))).toBeUndefined();
		expect(readWv3Layout(wv3File([], { declaredBlocks: -1 }))).toBeUndefined();
		expect(readWv3Layout(Buffer.alloc(HEADER_SIZE - 1, 0x00))).toBeUndefined();
	});

	it("reports the two channel format of the sound", async () => {
		const data = wv3File([block([0, 0], [[1], [2]])], { sampleRate: 44100 });
		const handle = await eveWv3AudioFormat.open(sourceOf(data), "dir/bgm.wv3");
		expect(handle.entries[0]?.path).toBe("bgm.wav");
		expect(handle.metadata).toMatchObject({
			audio: "wav",
			formatTag: 1,
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 16,
		});
		const layout = readWv3Layout(data);
		expect(layout?.format.averageBytesPerSecond).toBe(44100 * 4);
		expect(layout?.format.blockAlign).toBe(4);
		// Two blocks of the stream unfold to five hundred and sixty bytes of samples.
		expect(layout?.sampleCount).toBe(1);
	});

	it("writes the sound out as a wave file", async () => {
		const data = wv3File(
			[
				block(
					[0, 0],
					[
						[0, 1, 2, 3],
						[4, 5, 6, 7],
					],
				),
			],
			{
				sampleRate: 8000,
			},
		);
		const wave = await extract(data);
		expect(wave.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(wave.subarray(8, 12).toString("latin1")).toBe("WAVE");
		expect(wave.readUInt16LE(0x14)).toBe(1);
		expect(wave.readUInt16LE(0x16)).toBe(2);
		expect(wave.readUInt32LE(0x18)).toBe(8000);
		expect(wave.readUInt16LE(0x20)).toBe(4);
		expect(wave.readUInt16LE(0x22)).toBe(16);
		expect(wave.readUInt32LE(0x28)).toBe(BLOCK_BYTES);
		// The first frame of the sound: the two channels, each with its two samples of the block's first byte.
		expect(sampleRun(wave, PCM_OFFSET).slice(0, 4)).toEqual([0, 4, 1, 5]);
		expect(sampleRun(wave, PCM_OFFSET).slice(4, 8)).toEqual([2, 6, 3, 7]);
	});

	it("keeps the four-bit samples of the sound signed", async () => {
		// A channel byte of nothing leaves the weights out of it, so every sample is the four bits it stands in.
		const data = wv3File([
			block(
				[0, 0],
				[
					[7, -8, -1, 0],
					[1, 2, 3, 4],
				],
			),
		]);
		const wave = await extract(data);
		expect(sampleRun(wave, PCM_OFFSET).slice(0, 4)).toEqual([7, 1, -8, 2]);
		expect(sampleRun(wave, PCM_OFFSET).slice(4, 8)).toEqual([-1, 3, 0, 4]);
	});

	it("shifts the samples of a channel up by the count its byte holds", async () => {
		// The low nibble of the channel byte is the count, and the high nibble keeps the weights out of it.
		const data = wv3File([
			block(
				[0x04, 0x04],
				[
					[1, -1, 2, -2],
					[3, -3, 4, -4],
				],
			),
		]);
		const wave = await extract(data);
		expect(sampleRun(wave, PCM_OFFSET).slice(0, 4)).toEqual([16, 48, -16, -48]);
	});

	it("weighs the two samples behind a sample of a channel", async () => {
		// A channel byte of `0x50`: no shift, and the weights taken sixty or so samples wide.
		// The first sample stands on nothing: seven. The second: (-208*0 + 460*7) >> 8 = 12, and one more.
		const data = wv3File([
			block(
				[0x50, 0x50],
				[
					[7, 1],
					[0, 0],
				],
			),
		]);
		const wave = await extract(data);
		const samples = sampleRun(wave, PCM_OFFSET);
		expect(samples[0]).toBe(7);
		expect(samples[2]).toBe(13);
		// A channel byte of `0x70`: the same, with the weights the largest the table holds.
		// The second sample: (-240*0 + 488*7) >> 8 = 13, and one more.
		const other = wv3File([
			block(
				[0x70, 0x70],
				[
					[7, 1],
					[0, 0],
				],
			),
		]);
		const samples2 = sampleRun(await extract(other), PCM_OFFSET);
		expect(samples2[0]).toBe(7);
		expect(samples2[2]).toBe(14);
	});

	it("refuses a block that names a weight outside the table", async () => {
		// The high nibble of a channel byte picks the weights, and the table holds eight pairs of them, so a
		// byte that names the ninth pair is where the reference's own reader would run past its table.
		const data = wv3File([
			block(
				[0x80, 0x00],
				[
					[1, 2],
					[3, 4],
				],
			),
		]);
		expect(await eveWv3AudioFormat.detect(sourceOf(data), "bgm.wv3")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow(
			"Eve sound names a weight outside its table",
		);
	});

	it("leaves the rest of the sound at nothing where the stream is short of a block", async () => {
		const data = wv3File([block([0, 0], [[1], [2]])], { declaredBlocks: 3 });
		const wave = await extract(data);
		expect(wave.readUInt32LE(0x28)).toBe(3 * BLOCK_BYTES);
		const samples = sampleRun(wave, PCM_OFFSET);
		expect(samples[0]).toBe(1);
		expect(samples[1]).toBe(2);
		// Everything behind the one block of the stream stands at nothing.
		expect(samples.slice(140).every((value) => 0 === value)).toBe(true);
	});

	it("reads a block from anywhere the header says", async () => {
		const data = wv3File([block([0, 0], [[5], [6]])], { dataOffset: 0x40 });
		expect(readWv3Layout(data)?.dataOffset).toBe(0x40);
		const wave = await extract(data);
		expect(sampleRun(wave, PCM_OFFSET).slice(0, 2)).toEqual([5, 6]);
	});

	it("refuses a sound it cannot hold", async () => {
		const data = wv3File([], { declaredBlocks: 0x100000 });
		expect(await eveWv3AudioFormat.detect(sourceOf(data), "bgm.wv3")).toBe(
			true,
		);
		await expect(extract(data)).rejects.toThrow(GarbroError);
		await expect(extract(data)).rejects.toThrow("is too large");
	});

	it("unfolds a block of the sound on its own", () => {
		const data = wv3File([
			block(
				[0, 0],
				[
					[1, 2],
					[3, 4],
				],
			),
		]);
		const layout = readWv3Layout(data);
		if (!layout) throw new Error("no layout");
		const pcm = decodeWv3(data, layout);
		expect(pcm.length).toBe(BLOCK_BYTES);
		expect(sampleRun(pcm).slice(0, 4)).toEqual([1, 3, 2, 4]);
	});
});
