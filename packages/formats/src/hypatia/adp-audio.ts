// Format reference: GARbro "ArcFormats/Hypatia/AudioADP.cs", classes `AdpAudio` and `AdpDecoder`. The sound
// is a four bit differential stream, each nibble of which stands for one sample of a channel.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
} from "../shared/fixed-archive.js";
import { writeWave, type WavFormat } from "../shared/wav.js";

/** The four bytes of the signature, which the reference packs into a word. */
const SIGNATURE = Buffer.from("ADP1", "latin1");
const HEADER_SIZE = 0x10;
const SAMPLE_COUNT_FIELD = 4;
const SAMPLE_RATE_FIELD = 8;
const CHANNELS_FIELD = 12;
/** The rates the reference is willing to read. */
const MIN_RATE = 8000;
const MAX_RATE = 96000;
const BITS_PER_SAMPLE = 16;
/** The four bit samples stand on their own, one nibble at a time, with no block of the stream. */
const BLOCK_ALIGN_PER_CHANNEL = 2;
/** How many steps of the quantiser the decoder knows, which is also the last one it can stand at. */
const LAST_QUANTIZER = 48;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

const QUANTIZE_TABLE = [
	0x0010, 0x0011, 0x0013, 0x0015, 0x0017, 0x0019, 0x001c, 0x001f, 0x0022,
	0x0025, 0x0029, 0x002d, 0x0032, 0x0037, 0x003c, 0x0042, 0x0049, 0x0050,
	0x0058, 0x0061, 0x006b, 0x0076, 0x0082, 0x008f, 0x009d, 0x00ad, 0x00be,
	0x00d1, 0x00e6, 0x00fd, 0x0117, 0x0133, 0x0151, 0x0173, 0x0198, 0x01c1,
	0x01ee, 0x0220, 0x0256, 0x0292, 0x02d4, 0x031c, 0x036c, 0x03c3, 0x0424,
	0x048e, 0x0502, 0x0583, 0x0610,
];
const SCALE_TABLE = [
	2, 6, 0xa, 0xe, 0x12, 0x16, 0x1a, 0x1e, -2, -6, -0xa, -0xe, -0x12, -0x16,
	-0x1a, -0x1e,
];
const INCREMENT_TABLE = [
	-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
];

export interface AdpLayout {
	/** How many samples the sound holds over all of its channels. */
	sampleCount: number;
	format: WavFormat;
}

function invalidAudio(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AdpAudio.TryOpen`: the four bytes `ADP1`, how many samples the sound holds, the rate of them, which has to
 * stand between eight thousand and ninety six thousand, and the channels, of which there may be one or two.
 * The count of the samples stands for one channel, so it is taken once for every channel of the sound.
 */
export function readAdpLayout(data: Buffer): AdpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	if (sampleRate < MIN_RATE || sampleRate > MAX_RATE) return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (1 !== channels && 2 !== channels) return undefined;
	const held = data.readInt32LE(SAMPLE_COUNT_FIELD);
	if (held <= 0) return undefined;
	const sampleCount = held * channels;
	if (!Number.isSafeInteger(sampleCount)) return undefined;
	return {
		sampleCount,
		format: {
			formatTag: 1,
			channels,
			sampleRate,
			averageBytesPerSecond: channels * sampleRate * BLOCK_ALIGN_PER_CHANNEL,
			blockAlign: channels * BLOCK_ALIGN_PER_CHANNEL,
			bitsPerSample: BITS_PER_SAMPLE,
		},
	};
}

/**
 * `AdpDecoder`: a sample is the step its four bits name, weighed by the quantiser the decoder stands at, put
 * on top of the sample before it and held inside what sixteen bits can carry; the quantiser then steps by the
 * amount the same four bits name and is held between the first and the last step of the table. A sound of one
 * channel takes both nibbles of every byte and one decoder for them both, while a sound of two takes one
 * nibble to a channel and a decoder to each, so a byte of the stream is one sample of each channel.
 */
class AdpDecoder {
	private previous = 0;
	private quantizer = 0;

	decode(source: number): number {
		const step = source & 0x0f;
		let sample =
			(SCALE_TABLE[step] ?? 0) * (QUANTIZE_TABLE[this.quantizer] ?? 0) +
			this.previous;
		if (sample < -32768) sample = -32768;
		else if (sample > 0x7fff) sample = 0x7fff;
		this.previous = sample;
		this.quantizer += INCREMENT_TABLE[step] ?? 0;
		if (this.quantizer < 0) this.quantizer = 0;
		else if (this.quantizer > LAST_QUANTIZER) this.quantizer = LAST_QUANTIZER;
		return sample;
	}
}

/**
 * `AdpAudio.TryOpen`: the stream behind the header is read a byte at a time, the low nibble of which stands
 * for the sample of the first channel and the high one for the sample of the second; a sound of one channel
 * takes the low nibble first and the high one next, both of them through the same decoder. The count of the
 * samples ends the walk, and a stream that runs out before it leaves the rest of the sound at nothing.
 */
export function decodeAdp(data: Buffer, layout: AdpLayout): Buffer {
	const out: Buffer = Buffer.alloc(
		layout.sampleCount * BLOCK_ALIGN_PER_CHANNEL,
		0x00,
	);
	const first = new AdpDecoder();
	const second = layout.format.channels > 1 ? new AdpDecoder() : first;
	let at = HEADER_SIZE;
	let dst = 0;
	let left = layout.sampleCount;
	while (left > 0) {
		const value = at < data.length ? (data[at++] ?? 0) : -1;
		if (-1 === value) break;
		out.writeUInt16LE(first.decode(value) & 0xffff, dst);
		left -= 1;
		if (0 === left) break;
		dst += 2;
		out.writeUInt16LE(second.decode(value >> 4) & 0xffff, dst);
		dst += 2;
		left -= 1;
	}
	return out;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const hypatiaAdpAudioDescriptor: FormatDescriptor = {
	id: "hypatia-adp-audio",
	name: "Hypatia compressed audio format",
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
			source: "ArcFormats/Hypatia/AudioADP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const hypatiaAdpAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hypatiaAdpAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readAdpLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readAdpLayout(await readStored(source));
		if (!layout) {
			throw invalidAudio("Not a Hypatia sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "wav"),
						offset: 0n,
						size: source.size,
						compressed: true,
						metadata: { type: "audio" } as Record<string, unknown>,
					}),
					// The sound is reserialised as a wave file, which need not be the stored length.
					sizeKnown: false,
				},
			],
			metadata: {
				audio: "wav",
				formatTag: layout.format.formatTag,
				channels: layout.format.channels,
				sampleRate: layout.format.sampleRate,
				bitsPerSample: layout.format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readAdpLayout(stored);
		if (!layout) {
			throw invalidAudio("Not a Hypatia sound");
		}
		const size = layout.sampleCount * BLOCK_ALIGN_PER_CHANNEL;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Hypatia sound of ${size} bytes is too large`,
			);
		}
		return Readable.from([writeWave(layout.format, decodeAdp(stored, layout))]);
	},
});
