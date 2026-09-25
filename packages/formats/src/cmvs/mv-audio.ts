// Format reference: GARBro "ArcFormats/Cmvs/AudioMV.cs", classes `MvAudio` and `MvDecoder` (the file's
// `MvDecoderBase` and its `MvDecoder.Coef1Table` are shared with the newer sound of this engine, which is
// ported in `mv2-audio.ts`). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";
import {
	BITS_PER_SAMPLE,
	MV_DATA_START,
	MV_RUN_SAMPLES,
	MvBits,
	type MvLayout,
	clampSample,
	readMvLayout,
} from "./mv-common.js";
import {
	MV_COEF1_TABLE,
	MV_COEF2_TABLE,
	MV_SAMPLE_TABLE,
} from "./mv-tables.js";

/** The word of the older sound. */
const SIGNATURE = Buffer.from("MKVS", "latin1");
/** The places the filters gather their samples in. */
const PRE1_SIZE = 0x400;
const PRE2_SIZE = 0x400;
const PRE2_MASK = 0x3ff;
const ROUNDS = 10;
const COEF1_PER_ROUND = 64;
const COEF1_RUNS = 8;
const COEF1_PER_RUN = 4;
const ROUND_SAMPLES = 0x20;
const COEF2_READS = 0x10;
/** The samples of this sound are taken down by a constant one, where the newer one names its own shift. */
const DOWN_SHIFT = 1;
/** The places the second filter reads at, in the order it reads them. */
const COEF2_PLACES = [96, 32, 96, 32];

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** A product of two numbers, and a sum or a difference of them, as the reference's `int` keeps them. */
function product(left: number, right: number): number {
	return Math.imul(left, right) >> 10;
}

function sum(left: number, right: number): number {
	return (left + right) | 0;
}

/**
 * `MvDecoder`: the older sound of this engine. Its coefficients are gathered the same way as the newer one's,
 * but its two filters stand on places of its own - one place for both channels - its second filter reads its
 * coefficients one after the other rather than in strides, and its samples are written out flat, which the
 * reference itself marks as a question.
 */
export class MvDecoder {
	private readonly pre1 = new Int32Array(PRE1_SIZE);
	private readonly pre2 = new Int32Array(PRE2_SIZE);
	private readonly pre3: Int32Array;
	private readonly output: Buffer;
	private pre2Index = 0;

	constructor(
		private readonly data: Buffer,
		private readonly layout: MvLayout,
	) {
		this.pre3 = new Int32Array(MV_RUN_SAMPLES * layout.channels);
		this.output = Buffer.alloc(layout.blockAlign * layout.channelSize, 0x00);
	}

	/** `MvDecoder`'s own gathering of a run's coefficients into the first place. */
	private fillSample1(count: number, index: number, bits: MvBits): void {
		for (let at = 0; at < PRE1_SIZE; at += 1) this.pre1[at] = 0;
		// The reference reads this table as a signed word, and the run's scale is the whole of it.
		const scale = (MV_SAMPLE_TABLE[index] ?? 0) | 0;
		let at = 0;
		while (at < count && !bits.exhausted) {
			const width = bits.readCount();
			if (width > 0) {
				let coef = bits.readBits(width);
				if (coef < 1 << (width - 1)) coef += 1 - (1 << width);
				this.pre1[at] = Math.imul(scale, coef);
				at += 1;
			} else {
				at += bits.readBits(3) + 1;
			}
		}
	}

	/**
	 * `MvDecoder`'s own filters: sixty four samples from the run's coefficients, then thirty two of them
	 * through a second filter which reads sixteen coefficients one after another, four of them added and
	 * four subtracted at a time.
	 */
	private filterSamples(dst: number, src: number): void {
		const index2 = this.pre2Index;
		let coef1 = 0;
		for (let at = 0; at < COEF1_PER_ROUND; at += 1) {
			let source = src;
			let sample = 0;
			for (let run = 0; run < COEF1_RUNS; run += 1) {
				for (let step = 0; step < COEF1_PER_RUN; step += 1) {
					sample = sum(
						sample,
						product(MV_COEF1_TABLE[coef1] ?? 0, this.pre1[source] ?? 0),
					);
					coef1 += 1;
					source += 1;
				}
			}
			// The reference writes at `pre2_index + at` without keeping it inside its own place, which walks
			// off the end of it; this port keeps it inside.
			this.pre2[(index2 + at) & PRE2_MASK] = sample;
		}
		let out = dst;
		for (let at = 0; at < ROUND_SAMPLES; at += 1) {
			let place = index2 + at;
			let value = 0;
			for (let read = 0; read < COEF2_READS; read += 1) {
				const step = COEF2_PLACES[read & 3] ?? 0;
				// The reference's own counter runs on across the samples of a round rather than being reset
				// for each of them, so the table is read from beginning to end, sixteen to a sample.
				const coef = MV_COEF2_TABLE[at * COEF2_READS + read] ?? 0;
				const taken = product(this.pre2[place & PRE2_MASK] ?? 0, coef);
				// Every other pair of reads is subtracted, which is what the reference's `(~k & 2) - 1`
				// works out to for the count of reads it takes.
				value = 0 === (read & 2) ? sum(value, taken) : (value - taken) | 0;
				place += step;
			}
			this.pre3[out] = value;
			out += 1;
		}
		this.pre2Index = (this.pre2Index - 0x40) & PRE2_MASK;
	}

	/** `MvDecoder.Unpack`: every run of the walk, written out flat. */
	unpack(): Buffer {
		const bits = new MvBits(this.data, MV_DATA_START);
		const { channels, samples } = this.layout;
		let dstPos = 0;
		for (let run = 0; run < samples; run += 1) {
			if (dstPos >= this.output.length) break;
			for (let channel = 0; channel < channels; channel += 1) {
				const count = bits.readBits(10);
				const index = bits.readBits(10);
				if (bits.exhausted) return this.output;
				this.fillSample1(count, index, bits);
				let at = 0;
				for (let round = 0; round < ROUNDS; round += 1) {
					this.filterSamples(at, at);
					at += ROUND_SAMPLES;
				}
				// The reference writes the channels one after the other rather than interleaving them, and
				// marks that with a `shouldn't channel interleaving be taken into account?` of its own; the
				// walk here stops at the end of the sound rather than writing past it.
				let dst = dstPos;
				for (let sample = 0; sample < MV_RUN_SAMPLES; sample += 1) {
					if (dst + 2 > this.output.length) break;
					this.output.writeInt16LE(
						clampSample((this.pre3[sample] ?? 0) >> DOWN_SHIFT),
						dst,
					);
					dst += 2;
				}
			}
			dstPos += 2 * channels * MV_RUN_SAMPLES;
		}
		return this.output;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mvAudioDescriptor: FormatDescriptor = {
	id: "cmvs-mv-audio",
	name: "PVNS engine compressed audio",
	extensions: ["mv"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/AudioMV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mvAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mvAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MV_DATA_START)) return false;
		const stored = await readStored(source);
		if (!stored.subarray(0, 4).equals(SIGNATURE)) return false;
		return readMvLayout(stored) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMvLayout(await readStored(source));
		if (!layout) throw invalid("Not a PVNS engine sound");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "wav"),
				offset: 0n,
				size: BigInt(layout.blockAlign * layout.channelSize),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					bitsPerSample: BITS_PER_SAMPLE,
				},
			}),
			// The samples are unfolded and a wave header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "pvnsMV",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readMvLayout(stored);
		if (!layout || !stored.subarray(0, 4).equals(SIGNATURE)) {
			throw invalid("Not a PVNS engine sound");
		}
		const pcm = new MvDecoder(stored, layout).unpack();
		return Readable.from([
			writeWave(
				{
					formatTag: 1,
					channels: layout.channels,
					sampleRate: layout.sampleRate,
					averageBytesPerSecond: layout.blockAlign * layout.sampleRate,
					blockAlign: layout.blockAlign,
					bitsPerSample: BITS_PER_SAMPLE,
				},
				pcm,
			),
		]);
	},
});
