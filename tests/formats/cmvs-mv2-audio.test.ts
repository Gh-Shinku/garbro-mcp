import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { readWave } from "../../packages/formats/src/shared/wav.js";
import {
	MvBits,
	readMvLayout,
} from "../../packages/formats/src/cmvs/mv-common.js";
import {
	Mv2Decoder,
	mv2AudioFormat,
} from "../../packages/formats/src/cmvs/mv2-audio.js";
import {
	MV2_COEF2_TABLE,
	MV2_SAMPLE_TABLE,
	MV_COEF1_TABLE,
} from "../../packages/formats/src/cmvs/mv-tables.js";

const HEADER_SIZE = 0x12;
/** A head of the shape every sound of this family carries. */
function buildHead(options: {
	channels: number;
	sampleRate: number;
	channelSize: number;
	shift: number;
	samples: number;
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write("MV2X", 0, "latin1");
	head.writeInt32LE(options.channelSize, 4);
	head.writeUInt16LE(options.sampleRate, 0x0a);
	head[0x0c] = options.channels;
	head[0x0d] = options.shift;
	head.writeInt32LE(options.samples, 0x0e);
	return head;
}

/**
 * The stream of a run, written as the words the walk reads: every word is gathered least significant byte
 * first and consumed from its lowest bit up, so the bits of a word are written here from the low end.
 */
/** The bits of one value, most significant first, as the walk gathers them. */
function bitsFor(value: number, width: number): number[] {
	const bits: number[] = [];
	for (let at = width - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
	return bits;
}

/** The bits of a run of no coefficient at all, which steps over as many as its three bits name. */
function emptyRunBits(): number[] {
	return [...bitsFor(0, 10), ...bitsFor(0, 9), 0, ...bitsFor(1, 3)];
}

function streamWords(wordBits: number[][]): Buffer {
	const out: Buffer[] = [];
	for (const bits of wordBits) {
		// The bits of a run are laid out in words of their own, thirty two to a word.
		for (let at = 0; at < bits.length; at += 32) {
			let word = 0;
			for (const [index, bit] of bits.slice(at, at + 32).entries()) {
				if (bit) word = (word | (1 << index)) >>> 0;
			}
			const bytes = Buffer.alloc(4, 0x00);
			bytes.writeUInt32LE(word, 0);
			out.push(bytes);
		}
	}
	return Buffer.concat(out);
}

/**
 * The decoder of the reference, mirrored plainly here so that the port can be told apart from a
 * transcription slip of its own: the same two filters over the same tables, written straight through.
 */
function mirrorDecoder(
	data: Buffer,
	layout: {
		channels: number;
		blockAlign: number;
		samples: number;
		shift: number;
		channelSize: number;
	},
): Buffer {
	let at = HEADER_SIZE;
	let word = 0;
	let left = 0;
	const readBits = (count: number): number => {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			if (0 === left) {
				let built = 0;
				for (let byte = 0; byte < 4; byte += 1) {
					const place = at + byte;
					if (place < data.length) {
						built = (built | ((data[place] ?? 0) << (8 * byte))) >>> 0;
					}
				}
				word = built;
				at += 4;
				left = 32;
			}
			value = (value << 1) | (word & 1) | 0;
			word >>>= 1;
			left -= 1;
		}
		return value;
	};
	const readCount = (): number => {
		let count = 0;
		while (readBits(1) > 0) count += 1;
		return count;
	};
	const pre1 = new Int32Array(0x400);
	const pre2 = new Int32Array(0x400 * layout.channels);
	const pre3 = new Int32Array(0x140 * layout.channels);
	const out = Buffer.alloc(layout.blockAlign * layout.channelSize, 0x00);
	let pre2Index = 0;
	const mul = (a: number, b: number): number => Math.imul(a, b) >> 10;
	const add = (a: number, b: number): number => (a + b) | 0;
	let dstPos = 0;
	for (let run = 0; run < layout.samples && dstPos < out.length; run += 1) {
		for (let channel = 0; channel < layout.channels; channel += 1) {
			const count = readBits(10);
			const scale = MV2_SAMPLE_TABLE[readBits(9)] ?? 0;
			pre1.fill(0);
			let index = 0;
			while (index < count) {
				const width = readCount();
				if (width > 0) {
					let coef = readBits(width);
					if (coef < 1 << (width - 1)) coef += 1 - (1 << width);
					pre1[index] = Math.imul(scale, coef);
					index += 1;
				} else {
					index += readBits(3) + 1;
				}
			}
			let dst = 0;
			for (let round = 0; round < 10; round += 1) {
				const index2 = pre2Index + (channel << 10);
				let coef1 = 0;
				for (let j = 0; j < 64; j += 1) {
					let source = dst;
					let sample = 0;
					for (let k = 0; k < 8; k += 1) {
						for (let m = 0; m < 4; m += 1) {
							sample = add(
								sample,
								mul(MV_COEF1_TABLE[coef1] ?? 0, pre1[source] ?? 0),
							);
							coef1 += 1;
							source += 1;
						}
					}
					pre2[(index2 + j) % pre2.length] = sample;
				}
				let out2 = dst;
				for (let j = 0; j < 0x20; j += 1) {
					let place = index2 + j;
					let coef2 = j;
					let x = 0;
					for (let k = 0; k < 4; k += 1) {
						x = add(
							x,
							mul(pre2[place & 0x3ff] ?? 0, MV2_COEF2_TABLE[coef2] ?? 0),
						);
						coef2 += 32;
						place += 96;
						x = add(
							x,
							mul(pre2[place & 0x3ff] ?? 0, MV2_COEF2_TABLE[coef2] ?? 0),
						);
						coef2 += 32;
						place += 32;
						x =
							(x - mul(pre2[place & 0x3ff] ?? 0, MV2_COEF2_TABLE[coef2] ?? 0)) |
							0;
						coef2 += 32;
						place += 96;
						x =
							(x - mul(pre2[place & 0x3ff] ?? 0, MV2_COEF2_TABLE[coef2] ?? 0)) |
							0;
						coef2 += 32;
						place += 32;
					}
					pre3[out2] = x;
					out2 += 1;
				}
				pre2Index = (pre2Index - 0x40) & 0x3ff;
				dst += 0x20;
			}
			let to = dstPos + 2 * channel;
			for (let sample = 0; sample < 0x140; sample += 1) {
				if (to + 2 > out.length) break;
				const value = (pre3[sample] ?? 0) >> (6 - layout.shift);
				out.writeInt16LE(
					value > 0x7fff ? 0x7fff : value < -0x7fff ? -0x7fff : value,
					to,
				);
				to += layout.blockAlign;
			}
		}
		dstPos += 2 * layout.channels * 0x140;
	}
	return out;
}

describe("CVNS engine compressed audio", () => {
	it("reads the head of a sound", () => {
		const head = buildHead({
			channels: 2,
			sampleRate: 44100,
			channelSize: 4,
			shift: 3,
			samples: 2,
		});
		expect(readMvLayout(head)).toMatchObject({
			channels: 2,
			sampleRate: 44100,
			blockAlign: 4,
			channelSize: 4,
			shift: 3,
			samples: 2,
		});
		const noChannels = Buffer.from(head);
		noChannels[0x0c] = 0;
		expect(readMvLayout(noChannels)).toBeUndefined();
		expect(readMvLayout(head.subarray(0, 0x10))).toBeUndefined();
	});

	it("reads the bits of a word from its lowest up", () => {
		// A word of 0xA5: its lowest four bits stand first, and they are gathered most significant first.
		const data = Buffer.alloc(4, 0x00);
		data.writeUInt32LE(0xa5, 0);
		const bits = new MvBits(data, 0);
		// The lowest four bits of 0xA5 are 0101, gathered most significant first into 1010.
		expect(bits.readBits(4)).toBe(0b1010);
		expect(bits.readBits(4)).toBe(0b0101);
		// Bits run on into the word behind when a count asks for more than the word has left.
		expect(bits.readBits(8)).toBe(0);
		// A count of two stands for two ones and then the nothing that ends them, read from the low end.
		const ones = Buffer.alloc(8, 0x00);
		ones.writeUInt32LE(0b11, 0);
		const counted = new MvBits(ones, 0);
		expect(counted.readCount()).toBe(2);
		expect(counted.readBits(3)).toBe(0);
	});

	it("stops at the end of a sound rather than reading past it", () => {
		const short = Buffer.alloc(2, 0xff);
		const bits = new MvBits(short, 0);
		expect(bits.exhausted).toBe(false);
		// The two bytes that stand there make the low half of the word, and nothing stands behind them.
		expect(bits.readBits(16)).toBe(0xffff);
		expect(bits.exhausted).toBe(true);
		// A reader set back to the beginning forgets that it had run out.
		bits.setPosition(0);
		expect(bits.exhausted).toBe(false);
	});

	it("writes a sound of nothing when no coefficient stands behind its runs", () => {
		const run = emptyRunBits();
		const head = buildHead({
			channels: 1,
			sampleRate: 22050,
			channelSize: 1,
			shift: 0,
			samples: 1,
		});
		const data = Buffer.concat([head, streamWords([run])]);
		const layout = readMvLayout(data);
		if (!layout) throw new Error("no layout");
		const pcm = new Mv2Decoder(data, layout).unpack();
		expect(pcm).toEqual(
			Buffer.alloc(layout.blockAlign * layout.channelSize, 0x00),
		);
	});

	it("gathers the samples the walk names, as the reference does", () => {
		// Thirty-two coefficients, each of a width of one and a value of one, behind a place of the table
		// whose scale is large enough to survive the shifts of the filters - so the samples are not all
		// nothing, and every one of them stands on the coefficients the run named.
		const scaleIndex = MV2_SAMPLE_TABLE.findIndex((value) => value >= 4096);
		expect(scaleIndex).toBeGreaterThanOrEqual(0);
		const bits = [...bitsFor(32, 10), ...bitsFor(scaleIndex, 9)];
		for (let at = 0; at < 32; at += 1) {
			bits.push(...bitsFor(1, 1), 0, ...bitsFor(1, 1));
		}
		// The run stands for a whole row of samples, so every one of them is written out.
		const head = buildHead({
			channels: 1,
			sampleRate: 22050,
			channelSize: 0x140,
			shift: 0,
			samples: 1,
		});
		const data = Buffer.concat([head, streamWords([bits])]);
		const layout = readMvLayout(data);
		if (!layout) throw new Error("no layout");
		const pcm = new Mv2Decoder(data, layout).unpack();
		expect(pcm).toEqual(mirrorDecoder(data, layout));
		expect(pcm.length).toBe(0x140 * 2);
		expect([...pcm].some((byte) => byte !== 0)).toBe(true);
	});

	it("hands a whole sound over as a wave", async () => {
		const run = emptyRunBits();
		const head = buildHead({
			channels: 2,
			sampleRate: 44100,
			channelSize: 2,
			shift: 0,
			samples: 2,
		});
		const data = Buffer.concat([head, streamWords([run, run, run, run])]);
		const layout = readMvLayout(data);
		if (!layout) throw new Error("no layout");
		expect(new Mv2Decoder(data, layout).unpack()).toEqual(
			mirrorDecoder(data, layout),
		);
		const handle = await mv2AudioFormat.open(
			new BufferByteSource(data),
			"sound.mv2",
		);
		const entry = handle.entries[0];
		if (!entry) throw new Error("no entry");
		const wave = await consumeBuffer(await handle.openEntry(entry.id));
		const sound = readWave(wave);
		if (!sound) throw new Error("no wave");
		expect(sound.format).toMatchObject({
			channels: 2,
			sampleRate: 44100,
			bitsPerSample: 16,
		});
		expect(sound.dataSize).toBe(layout.blockAlign * layout.channelSize);
	});

	it("turns away a file that is not a sound of this engine", async () => {
		const head = buildHead({
			channels: 1,
			sampleRate: 22050,
			channelSize: 1,
			shift: 0,
			samples: 1,
		});
		const wrongWord = Buffer.from(head);
		wrongWord.write("XXXX", 0, "latin1");
		expect(
			await mv2AudioFormat.detect(new BufferByteSource(wrongWord), "sound.mv2"),
		).toBe(false);
		await expect(
			mv2AudioFormat.open(
				new BufferByteSource(Buffer.alloc(0x20, 0x00)),
				"sound.mv2",
			),
		).rejects.toThrow(GarbroError);
	});
});
