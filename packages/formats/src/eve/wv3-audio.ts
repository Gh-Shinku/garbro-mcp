// Format reference: GARbro "Legacy/Eve/AudioWV.cs", classes `Wv3Audio` and `Wv3Decoder`. The sound is a
// two channel adaptive differential stream, which the port unfolds and hands out as a wave file.
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

/** The four bytes of the signature, which the reference packs into a word, and the letter behind them. */
const SIGNATURE = Buffer.from("WV3.", "latin1");
const LETTER = 0x30;
const HEADER_SIZE = 0x26;
const DATA_OFFSET_FIELD = 6;
const SAMPLE_RATE_FIELD = 0x0e;
const SAMPLE_COUNT_FIELD = 0x1a;
/** A block of the stream: the two bytes of the channels and the samples behind them. */
const BLOCK_SIZE = 72;
/** The bytes one block of the stream unfolds to. */
const BLOCK_BYTES = 280;
const CHANNELS = 2;
/** How many bytes of the block stand for one channel's samples, two to a byte. */
const SAMPLES_PER_CHANNEL = 35;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = 4;
/** How many pairs of weights a block's channel byte can choose between. */
const SCALE_PAIRS = 8;
/** The pairs of weights the two bytes at the front of a block choose between. */
const SCALE_MAP = [
	0, 240, 128, 192, 320, 460, 392, 488, 0, 0, -12, -56, -88, -208, -220, -240,
];
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Wv3Layout {
	/** The two channels of the sound are always held as sixteen bit samples. */
	format: WavFormat;
	dataOffset: number;
	sampleCount: number;
}

function invalidAudio(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `Wv3Audio.TryOpen` and `Wv3Decoder`: the four bytes `WV3.` and the letter `0` behind them, then the place
 * the stream stands at, the rate of the samples and how many blocks the sound holds. A sound of no blocks is
 * turned away, since it holds nothing to unfold.
 */
export function readWv3Layout(data: Buffer): Wv3Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (LETTER !== (data[4] ?? 0)) return undefined;
	const sampleCount = data.readInt32LE(SAMPLE_COUNT_FIELD);
	if (sampleCount <= 0) return undefined;
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	return {
		format: {
			formatTag: 1,
			channels: CHANNELS,
			sampleRate,
			averageBytesPerSecond: sampleRate * BLOCK_ALIGN,
			blockAlign: BLOCK_ALIGN,
			bitsPerSample: BITS_PER_SAMPLE,
		},
		dataOffset: data.readUInt32LE(DATA_OFFSET_FIELD),
		sampleCount,
	};
}

/**
 * `Wv3Decoder.Decode`: a block of seventy two bytes holds two bytes that choose the weights of the two
 * channels and thirty five bytes for each of them, every byte of which holds two four-bit samples. Each
 * sample is the two samples before it of its own channel, weighted, taken eight bits down, with the four-bit
 * sample shifted up by the channel's own count put on top; the byte of the sound holds two samples, so a
 * block unfolds to thirty five frames of four bytes each. The samples are counted the wide way the reference
 * counts them and kept as the sixteen bits they land in, while what stands behind them for the next sample is
 * the wide value itself. A block the stream is too short for ends the unfold, leaving the rest of the sound
 * at nothing.
 */
export function decodeWv3(data: Buffer, layout: Wv3Layout): Buffer {
	const out: Buffer = Buffer.alloc(layout.sampleCount * BLOCK_BYTES, 0x00);
	const block: Buffer = Buffer.alloc(BLOCK_SIZE, 0x00);
	const output: Buffer = Buffer.alloc(BLOCK_BYTES, 0x00);
	const back0 = [0, 0];
	const back1 = [0, 0];
	let outPos = 0;
	let at = layout.dataOffset;
	for (let index = 0; index < layout.sampleCount; index += 1) {
		if (data.length - at < BLOCK_SIZE) break;
		data.copy(block, 0, at, at + BLOCK_SIZE);
		at += BLOCK_SIZE;
		for (let channel = 0; channel < CHANNELS; channel += 1) {
			let value = block[channel] ?? 0;
			const shift = value & 0x0f;
			value >>= 4;
			// The table holds eight pairs of weights, and a byte that names a ninth is where the reference's
			// own reader would run past the end of it.
			if (value >= SCALE_PAIRS) {
				throw invalidAudio("Eve sound names a weight outside its table");
			}
			const scale0 = SCALE_MAP[value + SCALE_PAIRS] ?? 0;
			const scale1 = SCALE_MAP[value] ?? 0;
			let src = SAMPLES_PER_CHANNEL * channel + 2;
			for (let sample = 0; sample < SAMPLES_PER_CHANNEL; sample += 1) {
				const dst = (channel + (sample << 2)) * 2;
				value = block[src] ?? 0;
				src += 1;
				let low = value & 0x0f;
				if (0 !== (low & 8)) low |= -0x10;
				let wide =
					((scale0 * (back0[channel] ?? 0) + scale1 * (back1[channel] ?? 0)) >>
						8) +
					(low << shift);
				wide |= 0;
				back0[channel] = back1[channel] ?? 0;
				back1[channel] = wide;
				output.writeUInt16LE(wide & 0xffff, dst);

				let high = value >> 4;
				if (0 !== (high & 8)) high |= -0x10;
				wide =
					((scale0 * (back0[channel] ?? 0) + scale1 * (back1[channel] ?? 0)) >>
						8) +
					(high << shift);
				wide |= 0;
				back0[channel] = back1[channel] ?? 0;
				back1[channel] = wide;
				output.writeUInt16LE(wide & 0xffff, dst + 4);
			}
		}
		// The reference copies the block of the sound out of its own buffer, which the port does as it stands.
		output.copy(out, outPos);
		outPos += BLOCK_BYTES;
	}
	return out;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const eveWv3AudioDescriptor: FormatDescriptor = {
	id: "eve-wv3-audio",
	name: "Eve compressed audio format",
	extensions: ["wv3", "wav"],
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
			source: "Legacy/Eve/AudioWV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eveWv3AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eveWv3AudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		return readWv3Layout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readWv3Layout(await readStored(source));
		if (!layout) {
			throw invalidAudio("Not an Eve sound");
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
		const layout = readWv3Layout(stored);
		if (!layout) {
			throw invalidAudio("Not an Eve sound");
		}
		const size = layout.sampleCount * BLOCK_BYTES;
		if (!Number.isSafeInteger(size) || size > LIMIT) {
			throw new GarbroError(
				"LIMIT_EXCEEDED",
				`Eve sound of ${size} bytes is too large`,
			);
		}
		return Readable.from([writeWave(layout.format, decodeWv3(stored, layout))]);
	},
});
