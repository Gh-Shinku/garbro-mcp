// Format reference: GARBro "ArcFormats/Cmvs/AudioMV2.cs", classes `Mv2Audio` and `Mv2Decoder`, which stands
// on the `MvDecoderBase` of "ArcFormats/Cmvs/AudioMV.cs" (its `MvDecoder.Coef1Table` is the first filter's
// coefficients). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	MV_SAMPLE_BYTES,
	MvBits,
	type MvLayout,
	clampSample,
	readMvLayout,
} from "./mv-common.js";
import {
	MV2_COEF2_TABLE,
	MV2_SAMPLE_TABLE,
	MV_COEF1_TABLE,
} from "./mv-tables.js";

/** The word of the newer sound. */
const SIGNATURE = Buffer.from("MV2X", "latin1");
/** The places the filters gather their samples in. */
const PRE1_SIZE = 0x400;
const PRE2_PER_CHANNEL = 0x400;
const PRE2_MASK = 0x3ff;
const ROUNDS = 10;
const COEF1_PER_ROUND = 64;
const COEF1_RUNS = 8;
const COEF1_PER_RUN = 4;
const ROUND_SAMPLES = 0x20;
const COEF2_STEP = 32;
/** The shift the samples are taken down by, behind the one the head names. */
const SHIFT_BASE = 6;

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** A product of two numbers, and a sum of them, as the reference's own `int` arithmetic keeps them. */
function product(left: number, right: number): number {
	return Math.imul(left, right) >> 10;
}

function sum(left: number, right: number): number {
	return (left + right) | 0;
}

/**
 * `Mv2Decoder`: every run names how many coefficients stand behind it and reads them as signed values of
 * their own width; the samples are then gathered through two filters, the first standing on those
 * coefficients and the second on the samples the first gathered.
 */
export class Mv2Decoder {
	private readonly pre1 = new Int32Array(PRE1_SIZE);
	private readonly pre2: Int32Array;
	private readonly pre3: Int32Array;
	private readonly output: Buffer;
	private pre2Index = 0;

	constructor(
		private readonly data: Buffer,
		private readonly layout: MvLayout,
	) {
		this.pre2 = new Int32Array(PRE2_PER_CHANNEL * layout.channels);
		this.pre3 = new Int32Array(MV_RUN_SAMPLES * layout.channels);
		this.output = Buffer.alloc(layout.blockAlign * layout.channelSize, 0x00);
	}

	/** `Mv2Decoder.FillSample1`: the coefficients of one run, gathered into the first place. */
	private fillSample1(count: number, index: number, bits: MvBits): void {
		// Only the first row is cleared, as the reference does: the tail of the place is left as the run
		// before this one left it, and the first filter reads into it.
		for (let at = 0; at < MV_RUN_SAMPLES; at += 1) this.pre1[at] = 0;
		const scale = MV2_SAMPLE_TABLE[index] ?? 0;
		let at = 0;
		while (at < count && !bits.exhausted) {
			const width = bits.readCount();
			if (width > 0) {
				let coef = bits.readBits(width);
				if (coef < 1 << (width - 1)) coef += 1 - (1 << width);
				this.pre1[at] = Math.imul(scale, coef);
				at += 1;
			} else {
				// A run of no width stands for as many coefficients as the three bits behind it name.
				at += bits.readBits(3) + 1;
			}
		}
	}

	/**
	 * `Mv2Decoder.FilterSamples`: sixty four samples are gathered from the run's own coefficients and then
	 * read through a second filter, which takes its coefficients four at a time and subtracts every other.
	 */
	private filterSamples(dst: number, src: number, channel: number): void {
		const index2 = this.pre2Index + (channel << 10);
		const ring = this.pre2.length - 1;
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
			// The reference writes at `index2 + at` without keeping it inside the ring, which walks off the
			// end of its own place for a sound of more than one channel; this port keeps it inside.
			this.pre2[(index2 + at) & ring] = sample;
		}
		let out = dst;
		for (let at = 0; at < ROUND_SAMPLES; at += 1) {
			let place = index2 + at;
			let coef2 = at;
			let value = 0;
			for (let step = 0; step < 4; step += 1) {
				value = sum(
					value,
					product(
						this.pre2[place & PRE2_MASK] ?? 0,
						MV2_COEF2_TABLE[coef2] ?? 0,
					),
				);
				coef2 += COEF2_STEP;
				place += 96;
				value = sum(
					value,
					product(
						this.pre2[place & PRE2_MASK] ?? 0,
						MV2_COEF2_TABLE[coef2] ?? 0,
					),
				);
				coef2 += COEF2_STEP;
				place += 32;
				value = sum(
					value,
					-product(
						this.pre2[place & PRE2_MASK] ?? 0,
						MV2_COEF2_TABLE[coef2] ?? 0,
					),
				);
				coef2 += COEF2_STEP;
				place += 96;
				value = sum(
					value,
					-product(
						this.pre2[place & PRE2_MASK] ?? 0,
						MV2_COEF2_TABLE[coef2] ?? 0,
					),
				);
				coef2 += COEF2_STEP;
				place += 32;
			}
			this.pre3[out] = value;
			out += 1;
		}
		this.pre2Index = (this.pre2Index - 0x40) & PRE2_MASK;
	}

	/** `Mv2Decoder.Unpack`: every run of the walk, written out as samples of its own. */
	unpack(): Buffer {
		const bits = new MvBits(this.data, MV_DATA_START);
		const { channels, blockAlign, samples, shift } = this.layout;
		const down = SHIFT_BASE - shift;
		let dstPos = 0;
		for (let run = 0; run < samples; run += 1) {
			if (dstPos >= this.output.length) break;
			for (let channel = 0; channel < channels; channel += 1) {
				const count = bits.readBits(10);
				const index = bits.readBits(9);
				if (bits.exhausted) return this.output;
				this.fillSample1(count, index, bits);
				let at = 0;
				for (let round = 0; round < ROUNDS; round += 1) {
					this.filterSamples(at, at, channel);
					at += ROUND_SAMPLES;
				}
				let dst = dstPos + MV_SAMPLE_BYTES * channel;
				for (let sample = 0; sample < MV_RUN_SAMPLES; sample += 1) {
					if (dst + MV_SAMPLE_BYTES > this.output.length) break;
					// `Clamp (pre_sample3[j] >> shift)`: the shift comes first and the clamp behind it.
					this.output.writeInt16LE(
						clampSample((this.pre3[sample] ?? 0) >> down),
						dst,
					);
					dst += blockAlign;
				}
			}
			dstPos += MV_SAMPLE_BYTES * channels * MV_RUN_SAMPLES;
		}
		return this.output;
	}
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mv2AudioDescriptor: FormatDescriptor = {
	id: "cmvs-mv2-audio",
	name: "CVNS engine compressed audio",
	extensions: ["mv2"],
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
			source: "ArcFormats/Cmvs/AudioMV2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mv2AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mv2AudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(MV_DATA_START)) return false;
		const stored = await readStored(source);
		if (!stored.subarray(0, 4).equals(SIGNATURE)) return false;
		return readMvLayout(stored) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMvLayout(await readStored(source));
		if (!layout) throw invalid("Not a CVNS engine sound");
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
				compression: "cvnsMV2",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
				shift: layout.shift,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readMvLayout(stored);
		if (!layout || !stored.subarray(0, 4).equals(SIGNATURE)) {
			throw invalid("Not a CVNS engine sound");
		}
		const pcm = new Mv2Decoder(stored, layout).unpack();
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
