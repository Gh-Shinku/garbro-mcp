// Format reference: GARbro "ArcFormats/Abogado/AudioADP.cs", classes `AdpAudio` and `AdpDecoder` (the
// engine's own four bit ADPCM). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const HEADER_SIZE = 0xc4;
const SAMPLE_RATE_FIELD = 0x00;
const CHANNELS_FIELD = 0x04;
/** The count of samples already counts every channel of a frame. */
const SAMPLES_FIELD = 0xbc;
const START_FIELD = 0xc0;
const MINIMUM_SAMPLE_RATE = 8000;
const MAXIMUM_SAMPLE_RATE = 96000;
const BITS_PER_SAMPLE = 16;
/** A stream this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/**
 * `AdpDecoder.QuantizeTable`, one step for every quantiser the walk may stand at.
 */
export const ADP_QUANTIZE_TABLE = new Uint16Array([
	0x0007, 0x0008, 0x0009, 0x000a, 0x000b, 0x000c, 0x000d, 0x000e, 0x0010,
	0x0011, 0x0013, 0x0015, 0x0017, 0x0019, 0x001c, 0x001f, 0x0022, 0x0025,
	0x0029, 0x002d, 0x0032, 0x0037, 0x003c, 0x0042, 0x0049, 0x0050, 0x0058,
	0x0061, 0x006b, 0x0076, 0x0082, 0x008f, 0x009d, 0x00ad, 0x00be, 0x00d1,
	0x00e6, 0x00fd, 0x0117, 0x0133, 0x0151, 0x0173, 0x0198, 0x01c1, 0x01ee,
	0x0220, 0x0256, 0x0292, 0x02d4, 0x031c, 0x036c, 0x03c3, 0x0424, 0x048e,
	0x0502, 0x0583, 0x0610, 0x06ab, 0x0756, 0x0812, 0x08e0, 0x09c3, 0x0abd,
	0x0bd0, 0x0cff, 0x0e4c, 0x0fba, 0x114c, 0x1307, 0x14ee, 0x1706, 0x1954,
	0x1bdc, 0x1ea5, 0x21b6, 0x2515, 0x28ca, 0x2cdf, 0x315b, 0x364b, 0x3bb9,
	0x41b2, 0x4844, 0x4f7e, 0x5771, 0x602f, 0x69ce, 0x7462, 0x7fff,
]);
/** `AdpDecoder.IncrementTable`, how far the quantiser moves for every code. */
const INCREMENT_TABLE = new Int8Array([
	-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
]);
const MAXIMUM_QUANTIZER = 0x58;

export interface AbogadoAdpLayout {
	sampleRate: number;
	channels: number;
	/** The number of samples of every channel of a frame, taken together. */
	samples: number;
	startOffset: number;
	/** The bytes of the stream the walk reads. */
	dataLength: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AdpAudio.TryOpen`: the sample rate stands at nought and has to be a rate a sound card would use, the
 * channel count at four and has to be one or two, the count of samples at `0xBC` — **already counting every
 * channel** — and the place of the stream at `0xC0`. Every nibble of two that follow is one sample, the
 * higher one first, so the bytes of the stream are the samples rounded up to two.
 */
export function readAbogadoAdpLayout(
	data: Buffer,
	fileLength = data.length,
): AbogadoAdpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	if (sampleRate < MINIMUM_SAMPLE_RATE || sampleRate > MAXIMUM_SAMPLE_RATE) {
		return undefined;
	}
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels !== 1 && channels !== 2) return undefined;
	const samples = data.readInt32LE(SAMPLES_FIELD) * channels;
	const startOffset = data.readInt32LE(START_FIELD);
	// The reference only turns away a place at or past the end; a place before the file is refused here
	// rather than left to the stream (a documented deviation in the message only).
	if (samples <= 0 || startOffset < 0 || startOffset >= fileLength) {
		return undefined;
	}
	const dataLength = Math.ceil(samples / 2);
	if (2 * samples > LIMIT || startOffset + dataLength > fileLength) {
		return undefined;
	}
	return { sampleRate, channels, samples, startOffset, dataLength };
}

/**
 * `AdpDecoder` of this port: one step of the engine's own ADPCM. The quantiser is taken before it moves, the step is the
 * quantiser scaled by the low three bits of the code, and the code's highest bit says which way the step
 * goes. The quantiser is kept within the table's bounds.
 */
export class AbogadoAdpDecoder {
	#previous = 0;
	#quantizer = 0;

	/**
	 * `AdpDecoder.Reset`: a chunk of a Masys payload hands the decoder the sample and the quantiser it
	 * starts from, where the container walk of this port keeps two decoders running instead.
	 */
	reset(sample: number, quantizer: number): void {
		this.#previous = sample;
		this.#quantizer = quantizer;
	}

	decode(code: number): number {
		const nibble = code & 0x0f;
		const quant = ADP_QUANTIZE_TABLE[this.#quantizer] ?? 0;
		this.#quantizer += INCREMENT_TABLE[nibble] ?? 0;
		if (this.#quantizer < 0) this.#quantizer = 0;
		else if (this.#quantizer > MAXIMUM_QUANTIZER) {
			this.#quantizer = MAXIMUM_QUANTIZER;
		}
		const step = ((2 * (nibble & 7) + 1) * quant) >> 3;
		let sample: number;
		if (nibble < 8) {
			sample = Math.min(0x7fff, this.#previous + step);
		} else {
			sample = Math.max(-32768, this.#previous - step);
		}
		this.#previous = sample;
		return sample;
	}
}

/**
 * `AdpAudio.TryOpen`'s walk: a byte holds two samples, the higher nibble first. A sound of one channel
 * decodes both nibbles with the same walk, so its own state carries from one to the next; a sound of two
 * channels gives the higher nibble to the first and the lower to the second.
 */
export function decodeAbogadoAdp(
	stored: Buffer,
	layout: AbogadoAdpLayout,
): Buffer {
	const first = new AbogadoAdpDecoder();
	const second = 1 === layout.channels ? first : new AbogadoAdpDecoder();
	const output: Buffer = Buffer.alloc(2 * layout.samples, 0x00);
	let samples = layout.samples;
	let source = layout.startOffset;
	let dst = 0;
	while (samples > 0) {
		if (source >= stored.length) {
			throw invalidSound("Abogado sound is cut short of its stream");
		}
		const value = stored[source] ?? 0;
		source += 1;
		output.writeInt16LE(first.decode(value >> 4), dst);
		samples -= 1;
		if (0 === samples) break;
		output.writeInt16LE(second.decode(value), dst + 2);
		dst += 4;
		samples -= 1;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const abogadoAdpAudioDescriptor: FormatDescriptor = {
	id: "abogado-adp-audio",
	name: "AbogadoPowers audio format",
	extensions: [],
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
			source: "ArcFormats/Abogado/AudioADP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const abogadoAdpAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abogadoAdpAudioDescriptor,
	// The reference registers the words `0x5622`, `0xAC44` and nought, the last of which stands for every
	// file; a candidate with no signature is tried after the ones that carry one.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readAbogadoAdpLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readAbogadoAdpLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidSound("Not an Abogado sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.startOffset),
				size: BigInt(layout.dataLength),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					samples: layout.samples,
					bitsPerSample: BITS_PER_SAMPLE,
				},
			}),
			// The samples are unfolded from the engine's own ADPCM and a wave header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "adpcm",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAbogadoAdpLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not an Abogado sound");
		}
		const pcm = decodeAbogadoAdp(stored, layout);
		return Readable.from([
			writeWave(
				{
					formatTag: 1,
					channels: layout.channels,
					sampleRate: layout.sampleRate,
					averageBytesPerSecond: 2 * layout.channels * layout.sampleRate,
					blockAlign: 2 * layout.channels,
					bitsPerSample: BITS_PER_SAMPLE,
				},
				pcm,
			),
		]);
	},
});
