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
	MvDecoder,
	mvAudioFormat,
} from "../../packages/formats/src/cmvs/mv-audio.js";
import {
	MV_COEF1_TABLE,
	MV_COEF2_TABLE,
	MV_SAMPLE_TABLE,
	MV2_SAMPLE_TABLE,
} from "../../packages/formats/src/cmvs/mv-tables.js";

const HEADER_SIZE = 0x12;
/** The word of this sound, and the length of the row its runs stand for. */
const SIGNATURE = "MKVS";
const ROW_SAMPLES = 0x140;

function buildHead(options: {
	channels: number;
	sampleRate: number;
	channelSize: number;
	shift: number;
	samples: number;
}): Buffer {
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write(SIGNATURE, 0, "latin1");
	head.writeInt32LE(options.channelSize, 4);
	head.writeUInt16LE(options.sampleRate, 0x0a);
	head[0x0c] = options.channels;
	head[0x0d] = options.shift;
	head.writeInt32LE(options.samples, 0x0e);
	return head;
}

/** The bits of one value, most significant first, as the walk gathers them. */
function bitsFor(value: number, width: number): number[] {
	const bits: number[] = [];
	for (let at = width - 1; at >= 0; at -= 1) bits.push((value >> at) & 1);
	return bits;
}

/** The bits of a run of no coefficient at all, which steps over as many as its three bits name. */
function emptyRunBits(): number[] {
	return [...bitsFor(0, 10), ...bitsFor(0, 10), 0, ...bitsFor(1, 3)];
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
 * The decoder of the reference, mirrored plainly here: the same two filters over the same tables, with the
 * second one reading its coefficients one after another and adding and subtracting them in fours.
 */
function mirrorDecoder(
	data: Buffer,
	layout: {
		channels: number;
		blockAlign: number;
		samples: number;
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
	const pre2 = new Int32Array(0x400);
	const pre3 = new Int32Array(ROW_SAMPLES * layout.channels);
	const out = Buffer.alloc(layout.blockAlign * layout.channelSize, 0x00);
	let pre2Index = 0;
	const mul = (a: number, b: number): number => Math.imul(a, b) >> 10;
	const add = (a: number, b: number): number => (a + b) | 0;
	let dstPos = 0;
	for (let run = 0; run < layout.samples && dstPos < out.length; run += 1) {
		for (let channel = 0; channel < layout.channels; channel += 1) {
			const count = readBits(10);
			const scale = (MV_SAMPLE_TABLE[readBits(10)] ?? 0) | 0;
			pre1.fill(0);
			for (let i = 0; i < count; i += 1) {
				const width = readCount();
				if (width > 0) {
					let coef = readBits(width);
					if (coef < 1 << (width - 1)) coef += 1 - (1 << width);
					pre1[i] = Math.imul(scale, coef);
				} else {
					i += readBits(3);
				}
			}
			let pre3Index = 0;
			for (let round = 0; round < 10; round += 1) {
				let coef1 = 0;
				for (let j = 0; j < 64; j += 1) {
					let source = pre3Index;
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
					pre2[(pre2Index + j) % pre2.length] = sample;
				}
				// The count runs on across the samples of the round, sixteen of them to each.
				let coef2Index = 0;
				for (let j = 0; j < 0x20; j += 1) {
					let x = 0;
					let m = pre2Index + j;
					for (let k = 0; k < 0x10; k += 1) {
						const coef = mul(
							pre2[m & 0x3ff] ?? 0,
							MV_COEF2_TABLE[coef2Index] ?? 0,
						);
						coef2Index += 1;
						x = add(x, ((~k & 2) - 1) * coef);
						// `~(k << 6) & 0x40 | 0x20`: the step is ninety six for an even count and thirty two for an
						// odd one, while the sign above turns on the count's second bit.
						m += (0 === (k & 1) ? 0x40 : 0) | 0x20;
					}
					pre3[pre3Index] = x;
					pre3Index += 1;
				}
				pre2Index = (pre2Index - 0x40) & 0x3ff;
			}
			let dst = dstPos;
			for (let j = 0; j < ROW_SAMPLES; j += 1) {
				if (dst + 2 > out.length) break;
				const value = (pre3[j] ?? 0) >> 1;
				out.writeInt16LE(
					value > 0x7fff ? 0x7fff : value < -0x7fff ? -0x7fff : value,
					dst,
				);
				dst += 2;
			}
		}
		dstPos += 2 * layout.channels * ROW_SAMPLES;
	}
	return out;
}

describe("PVNS engine compressed audio", () => {
	it("pins the tables of this sound", () => {
		// The scale table of this sound is the file's own short list placed at 0x192 of a kiloword table.
		expect(MV_SAMPLE_TABLE.length).toBe(0x400);
		expect(
			[...(MV_SAMPLE_TABLE.subarray(0, 0x192) ?? [])].every((v) => v === 0),
		).toBe(true);
		expect(MV_SAMPLE_TABLE[0x192]).toBe(1);
		// Its two coefficient tables are older and narrower than the ones of the newer sound.
		expect(MV_COEF1_TABLE.length).toBe(0x800);
		expect(MV_COEF2_TABLE.length).toBe(0x200);
		expect(MV2_SAMPLE_TABLE.length).toBe(0x200);
	});

	it("reads the head of a sound and turns away what is not one", async () => {
		const head = buildHead({
			channels: 2,
			sampleRate: 22050,
			channelSize: 1,
			shift: 0,
			samples: 1,
		});
		expect(readMvLayout(head)).toMatchObject({
			channels: 2,
			sampleRate: 22050,
			blockAlign: 4,
			channelSize: 1,
			samples: 1,
		});
		expect(await mvAudioFormat.detect(new BufferByteSource(head), "x.mv")).toBe(
			true,
		);
		// The word this sound carries stands before the head, so another sound of the engine is turned away.
		const newer = Buffer.from(head);
		newer.write("MV2X", 0, "latin1");
		expect(
			await mvAudioFormat.detect(new BufferByteSource(newer), "x.mv"),
		).toBe(false);
		await expect(
			mvAudioFormat.open(
				new BufferByteSource(Buffer.alloc(0x20, 0x00)),
				"x.mv",
			),
		).rejects.toThrow(GarbroError);
	});

	it("reads the bits of a word from its lowest up", () => {
		const data = Buffer.alloc(4, 0x00);
		data.writeUInt32LE(0x80000001, 0);
		const bits = new MvBits(data, 0);
		expect(bits.readBits(1)).toBe(1);
		// The thirty one bits behind it are the word's own high bit last, which is one.
		expect(bits.readBits(31)).toBe(1);
		const ones = Buffer.alloc(4, 0x00);
		ones.writeUInt32LE(0b111, 0);
		expect(new MvBits(ones, 0).readCount()).toBe(3);
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
		const pcm = new MvDecoder(data, layout).unpack();
		expect(pcm).toEqual(
			Buffer.alloc(layout.blockAlign * layout.channelSize, 0x00),
		);
		expect(pcm).toEqual(mirrorDecoder(data, layout));
	});

	it("gathers the samples the walk names, as the reference does", () => {
		// Thirty-two coefficients of one, behind a place of the table whose scale survives the shifts.
		const scaleIndex = MV_SAMPLE_TABLE.findIndex(
			(value, at) => at >= 0x192 && value >= 4096,
		);
		expect(scaleIndex).toBeGreaterThanOrEqual(0x192);
		const bits = [...bitsFor(32, 10), ...bitsFor(scaleIndex, 10)];
		for (let at = 0; at < 32; at += 1) {
			bits.push(...bitsFor(1, 1), 0, ...bitsFor(1, 1));
		}
		const head = buildHead({
			channels: 1,
			sampleRate: 22050,
			channelSize: ROW_SAMPLES,
			shift: 0,
			samples: 1,
		});
		const data = Buffer.concat([head, streamWords([bits])]);
		const layout = readMvLayout(data);
		if (!layout) throw new Error("no layout");
		const pcm = new MvDecoder(data, layout).unpack();
		expect(pcm).toEqual(mirrorDecoder(data, layout));
		expect(pcm.length).toBe(ROW_SAMPLES * 2);
		expect([...pcm].some((byte) => byte !== 0)).toBe(true);
	});

	it("hands a whole sound over as a wave", async () => {
		const run = emptyRunBits();
		const head = buildHead({
			channels: 2,
			sampleRate: 44100,
			channelSize: 2,
			shift: 5,
			samples: 2,
		});
		const data = Buffer.concat([head, streamWords([run, run, run, run])]);
		const layout = readMvLayout(data);
		if (!layout) throw new Error("no layout");
		expect(new MvDecoder(data, layout).unpack()).toEqual(
			mirrorDecoder(data, layout),
		);
		const handle = await mvAudioFormat.open(
			new BufferByteSource(data),
			"sound.mv",
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
});
