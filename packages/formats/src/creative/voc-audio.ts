// Format reference: GARbro "ArcFormats/AudioVOC.cs", classes `VocAudio` and `VocReader` (a Creative Voice
// File: a head and then blocks of their own, of which the four that carry samples say the format with them).
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
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave, type WavFormat } from "../shared/wav.js";

/** The mark of a Creative Voice File, a NUL of its own included. */
const MARK = "Creative Voice File\u001a";
const HEADER_SIZE = 0x1a;
const HEAD_SIZE_FIELD = 0x14;
const VERSION_FIELD = 0x16;
/** The block kinds the reference walks, of which the last is a terminator. */
const TERMINATOR_BLOCK = 0x00;
const SOUND_BLOCK = 0x01;
const CONTINUATION_BLOCK = 0x02;
const SOUND_BLOCK_8 = 0x08;
const SOUND_BLOCK_9 = 0x09;
/** The codecs a block may name, and the wave tag each stands for. */
const CODEC_PCM = 0x00;
const CODEC_PCM_16 = 0x04;
const CODEC_ULAW = 0x07;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface VocSound {
	format: WavFormat;
	pcm: Buffer;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `VocAudio.TryOpen` and `VocReader.ConvertToPcm`: the file begins with the mark `Creative Voice File` and a
 * NUL of its own, its head size stands at `0x14` as a word and may not be smaller than the head, and the
 * blocks stand behind it. Every block is a kind, a size of three bytes and then its own body:
 *
 * | kind | what the block holds |
 * | --- | --- |
 * | `1` | one channel of eight bit sound, with its frequency and its codec behind the head |
 * | `2` | more of the sound the block before it began |
 * | `8` | one or two channels of eight bit sound, with its frequency, its codec and its channel count |
 * | `9` | the sound of any depth, with its rate, its depth, its channel count and its codec, four bytes that are not read, and its samples |
 *
 * Every other kind is passed over, and a kind of nought ends the walk. The depth and the tag of the wave come
 * from the last codec a block named: nought is a plain wave, four is a wave of sixteen bits, and seven is a
 * wave of its own (`0x07`), whose samples stand as they are. The rate of the two eight bit kinds is worked
 * out of their own frequency byte or word, and the two averages are the rate times the block of a frame.
 */
export function convertVoc(stored: Buffer): VocSound | undefined {
	if (stored.length < HEADER_SIZE) return undefined;
	if (stored.subarray(0, MARK.length).toString("latin1") !== MARK) {
		return undefined;
	}
	const headerSize = stored.readUInt16LE(HEAD_SIZE_FIELD);
	if (headerSize < HEADER_SIZE || headerSize > stored.length) return undefined;
	const format: WavFormat = {
		formatTag: 0,
		channels: 0,
		sampleRate: 0,
		averageBytesPerSecond: 0,
		blockAlign: 0,
		bitsPerSample: 0,
	};
	const parts: Buffer[] = [];
	let formatRead = false;
	let position = headerSize;
	let length = 0;
	const readByte = (): number | undefined => {
		if (position >= stored.length) return undefined;
		const value = stored[position] ?? 0;
		position += 1;
		return value;
	};
	const copy = (count: number): boolean => {
		if (count < 0 || position + count > stored.length) return false;
		parts.push(Buffer.from(stored.subarray(position, position + count)));
		position += count;
		length += count;
		return true;
	};
	const skip = (count: number): boolean => {
		if (count < 0 || position + count > stored.length) return false;
		position += count;
		return true;
	};
	for (;;) {
		const blockType = readByte();
		if (blockType === undefined || TERMINATOR_BLOCK === blockType) break;
		const low = readByte();
		const high = readByte();
		const top = readByte();
		if (low === undefined || high === undefined || top === undefined) {
			return undefined;
		}
		const blockSize = low | (high << 8) | (top << 16);
		let codec = -1;
		switch (blockType) {
			case SOUND_BLOCK: {
				const frequency = readByte();
				const blockCodec = readByte();
				if (frequency === undefined || blockCodec === undefined) {
					return undefined;
				}
				codec = blockCodec;
				if (!copy(blockSize - 2)) return undefined;
				format.channels = 1;
				format.sampleRate = Math.trunc(1000000 / (256 - frequency));
				format.bitsPerSample = 8;
				formatRead = true;
				break;
			}
			case CONTINUATION_BLOCK: {
				if (!copy(blockSize)) return undefined;
				break;
			}
			case SOUND_BLOCK_8: {
				const lowFrequency = readByte();
				const highFrequency = readByte();
				const blockCodec = readByte();
				const channels = readByte();
				if (
					lowFrequency === undefined ||
					highFrequency === undefined ||
					blockCodec === undefined ||
					channels === undefined
				) {
					return undefined;
				}
				codec = blockCodec;
				format.channels = channels + 1;
				const frequency = (highFrequency << 8) | lowFrequency;
				format.sampleRate = Math.trunc(
					256000000 / (format.channels * (65536 - frequency)),
				);
				format.bitsPerSample = 8;
				formatRead = true;
				break;
			}
			case SOUND_BLOCK_9: {
				const rate = readInt32(readByte, readByte, readByte, readByte);
				const bits = readByte();
				const channels = readByte();
				const lowCodec = readByte();
				const highCodec = readByte();
				if (
					rate === undefined ||
					bits === undefined ||
					channels === undefined ||
					lowCodec === undefined ||
					highCodec === undefined
				) {
					return undefined;
				}
				codec = (highCodec << 8) | lowCodec;
				format.sampleRate = rate;
				format.bitsPerSample = bits;
				format.channels = channels + 1;
				formatRead = true;
				// Four bytes of the block's own are not read at all.
				if (!skip(4)) return undefined;
				if (!copy(blockSize - 12)) return undefined;
				break;
			}
			default: {
				if (!skip(blockSize)) return undefined;
				break;
			}
		}
		if (-1 !== codec) {
			if (CODEC_PCM === codec) {
				format.formatTag = 1;
			} else if (CODEC_PCM_16 === codec) {
				format.formatTag = 1;
				format.bitsPerSample = 16;
			} else if (CODEC_ULAW === codec) {
				format.formatTag = 7;
			} else {
				return undefined;
			}
		}
	}
	if (!formatRead || 0 === format.channels || 0 === length) return undefined;
	const pcm = Buffer.concat(parts);
	if (pcm.length > LIMIT) return undefined;
	format.blockAlign = Math.trunc((format.channels * format.bitsPerSample) / 8);
	format.averageBytesPerSecond = format.sampleRate * format.blockAlign;
	return { format, pcm };
}

/** The four bytes of a word, read a byte at a time, or nothing where the stream ends inside it. */
function readInt32(
	readByte: () => number | undefined,
	...rest: Array<() => number | undefined>
): number | undefined {
	const first = readByte();
	if (first === undefined) return undefined;
	let value = first;
	for (let index = 0; index < rest.length; index += 1) {
		const next = rest[index]?.();
		if (next === undefined) return undefined;
		value |= next << (8 * (index + 1));
	}
	return value | 0;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const creativeVocAudioDescriptor: FormatDescriptor = {
	id: "creative-voc-audio",
	name: "Creative Voice File",
	extensions: ["voc"],
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
			source: "ArcFormats/AudioVOC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const creativeVocAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: creativeVocAudioDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("Crea", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const stored = await readStored(source);
			return convertVoc(stored) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const sound = convertVoc(await readStored(source));
		if (!sound) {
			throw invalidSound("Not a Creative Voice File");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(sound.pcm.length),
				compressed: false,
				metadata: {
					type: "audio",
					sampleRate: sound.format.sampleRate,
					channels: sound.format.channels,
					bitsPerSample: sound.format.bitsPerSample,
					formatTag: sound.format.formatTag,
				},
			}),
			// The samples of every block stand as they are, and a wave header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: 7 === sound.format.formatTag ? "ulaw" : "pcm",
				sampleRate: sound.format.sampleRate,
				channels: sound.format.channels,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const sound = convertVoc(await readStored(source));
		if (!sound) {
			throw invalidSound("Not a Creative Voice File");
		}
		return Readable.from([writeWave(sound.format, sound.pcm)]);
	},
});
