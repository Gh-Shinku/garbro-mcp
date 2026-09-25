// Format reference: GARBro "ArcFormats/Cmvs/AudioMV.cs", class `MvDecoderBase` - the bit reader the two
// CVNS engine decoders of this family stand on, and the head they both read. GARBro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";

/** The head both decoders read, and the fields inside it. */
const HEADER_SIZE = 0x12;
const CHANNEL_SIZE_FIELD = 4;
const SAMPLE_RATE_FIELD = 0x0a;
const CHANNELS_FIELD = 0x0c;
const SHIFT_FIELD = 0x0d;
const SAMPLES_FIELD = 0x0e;
/** A sound of this engine is always of two bytes a sample. */
const BITS_PER_SAMPLE = 16;

export interface MvLayout {
	/** How many samples every channel holds, as the head counts them. */
	channelSize: number;
	channels: number;
	sampleRate: number;
	blockAlign: number;
	/** The shift the newer format takes its samples down by. */
	shift: number;
	/** How many runs of samples the walk stands for. */
	samples: number;
}

export function invalidMvSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MvDecoderBase.GetBits` and `GetCount`: a word of the stream is read least significant byte first and
 * consumed from its **lowest** bit up, with the bits gathered into a value most significant first. The run
 * of ones a count stands for is read one bit at a time.
 */
export class MvBits {
	private word = 0;
	private left = 0;
	/** Whether the walk has run past the sound it reads. */
	exhausted = false;

	constructor(
		private readonly data: Buffer,
		private from: number,
	) {}

	/** Where the reader has come to, which a caller may need to know. */
	get at(): number {
		return this.from;
	}

	/** `MvDecoderBase.SetPosition`: the walk begins again at a place of its own. */
	setPosition(at: number): void {
		this.from = at;
		this.left = 0;
		this.word = 0;
		this.exhausted = false;
	}

	readBits(count: number): number {
		let value = 0;
		let wanted = count;
		while (wanted > 0) {
			if (0 === this.left) {
				// A word at the end of a sound is read as the bytes that stand there and nothing behind
				// them - which is what the reference's own view gives - and the walk is marked exhausted.
				let word = 0;
				for (let byte = 0; byte < 4; byte += 1) {
					const at = this.from + byte;
					if (at < this.data.length) {
						word = (word | ((this.data[at] ?? 0) << (8 * byte))) >>> 0;
					} else {
						this.exhausted = true;
					}
				}
				this.word = word;
				this.from += 4;
				this.left = 32;
			}
			value = (value << 1) | (this.word & 1) | 0;
			this.word >>>= 1;
			this.left -= 1;
			wanted -= 1;
		}
		return value;
	}

	readCount(): number {
		let count = 0;
		while (this.readBits(1) > 0) count += 1;
		return count;
	}
}

/** `MvDecoderBase.Clamp`: a sample is held between the two ends of a signed word. */
export function clampSample(sample: number): number {
	if (sample > 0x7fff) return 0x7fff;
	if (sample < -0x7fff) return -0x7fff;
	return sample;
}

/**
 * The head of a sound of this family, which both of the engine's decoders read the same way. The reference
 * hands each field straight into its own format, so a channel count of nothing and a rate of nothing are
 * carried as they stand rather than refused.
 */
export function readMvLayout(data: Buffer): MvLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const channels = data[CHANNELS_FIELD] ?? 0;
	if (0 === channels) return undefined;
	const channelSize = data.readInt32LE(CHANNEL_SIZE_FIELD);
	const samples = data.readInt32LE(SAMPLES_FIELD);
	if (channelSize < 0 || samples < 0) return undefined;
	const blockAlign = (channels * BITS_PER_SAMPLE) / 8;
	if (blockAlign * channelSize > 0x10000000) return undefined;
	return {
		channelSize,
		channels,
		sampleRate: data.readUInt16LE(SAMPLE_RATE_FIELD),
		blockAlign,
		shift: data[SHIFT_FIELD] ?? 0,
		samples,
	};
}

/** The place the walk of a sound begins, which is behind its head. */
export const MV_DATA_START = HEADER_SIZE;
/** The bytes of a sample, and the samples one run of the walk stands for. */
export const MV_SAMPLE_BYTES = 2;
export const MV_RUN_SAMPLES = 0x140;
export { BITS_PER_SAMPLE };
