// Format reference: GARBro "ArcFormats/TechnoBrain/AudioWAPE.cs", classes `WapeAudio` and `WapeDecoder` (a
// wave whose samples are held as a walk of bits). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const RIFF_MARK = "RIFF";
const FORMAT_MARK = "WAPEfmt ";
const DATA_MARK = "data";
const HEADER_SIZE = 0x2c;
const FORMAT_TAG_FIELD = 0x14;
const CHANNELS_FIELD = 0x16;
const SAMPLE_RATE_FIELD = 0x18;
const AVERAGE_FIELD = 0x1c;
const BLOCK_ALIGN_FIELD = 0x20;
const BITS_FIELD = 0x22;
const DATA_MARK_FIELD = 0x24;
const PCM_SIZE_FIELD = 0x2c;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
/** The bit of a byte every count of bits is counted from. */
const MASKS = [1, 2, 4, 8, 0x10, 0x20, 0x40, 0x80] as const;

export interface WapeLayout {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
	/** The size of the wave the walk builds. */
	pcmSize: number;
	/** The bytes of the stream the walk reads. */
	dataLength: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `WapeAudio.TryOpen`: the file has to carry the marks `RIFF` at nought, `WAPEfmt ` at eight and `data` at
 * `0x24`, with the wave's own format fields between `0x14` and `0x22`. The size of the wave the walk builds
 * stands at `0x2C` as a word, and the walk of bits begins right behind it.
 */
export function readWapeLayout(
	data: Buffer,
	fileLength = data.length,
): WapeLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.subarray(0, 4).toString("latin1") !== RIFF_MARK) return undefined;
	if (data.subarray(8, 16).toString("latin1") !== FORMAT_MARK) return undefined;
	if (
		data.subarray(DATA_MARK_FIELD, DATA_MARK_FIELD + 4).toString("latin1") !==
		DATA_MARK
	) {
		return undefined;
	}
	const pcmSize = data.readInt32LE(PCM_SIZE_FIELD);
	if (pcmSize <= 0 || pcmSize > LIMIT) return undefined;
	if (fileLength < HEADER_SIZE + 4) return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels === 0) return undefined;
	return {
		formatTag: data.readUInt16LE(FORMAT_TAG_FIELD),
		channels,
		sampleRate: data.readUInt32LE(SAMPLE_RATE_FIELD),
		averageBytesPerSecond: data.readUInt32LE(AVERAGE_FIELD),
		blockAlign: data.readUInt16LE(BLOCK_ALIGN_FIELD),
		bitsPerSample: data.readUInt16LE(BITS_FIELD),
		pcmSize,
		dataLength: Math.max(0, fileLength - HEADER_SIZE - 4),
	};
}

/**
 * `WapeDecoder.GetBits`: a count of bits, taken from the highest bit of a byte downwards, and standing in
 * the value at the same heights — so a count of two gives `0x00`, `0x40`, `0x80` or `0xC0`, and a count of
 * seven leaves the lowest bit of the byte clear. A stream that ends is refused, where the reference would
 * throw at its own read.
 */
class WapeBits {
	readonly #data: Buffer;
	#position = 0;
	#byte = 0;
	#bit = 0;

	constructor(data: Buffer, position: number) {
		this.#data = data;
		this.#position = position;
		this.#bit = 0;
	}

	read(count: number): number {
		let value = 0;
		for (let index = 0; index < count; index += 1) {
			this.#bit -= 1;
			if (this.#bit < 0) {
				if (this.#position >= this.#data.length) {
					throw invalidSound("TechnoBrain sound is cut short of its stream");
				}
				this.#byte = this.#data[this.#position] ?? 0;
				this.#position += 1;
				this.#bit = 7;
			}
			if (0 !== (this.#byte & (MASKS[this.#bit] ?? 0))) {
				value |= MASKS[7 - index] ?? 0;
			}
		}
		return value;
	}
}

/**
 * `WapeDecoder.ConvertToPcm`: every step of the walk begins with a bit. A clear one is a byte that stands
 * itself, of only the seven bits the reader can hold — so a literal is always even. A set one is followed by
 * another bit: a clear one says the step is a small change of the byte before it, of two or four, told apart
 * by two more bits, and another clear one says a larger change of six or eight; a set one is a run of the
 * byte before, of up to four bytes, told apart by five more bits. Where a step leaves the byte before it as
 * `0xFE` it is written as `0xFF` instead, and a step with no byte before it, or a run that reaches past the
 * wave, is refused rather than left to the reference's own array (a documented deviation in the message
 * only).
 */
export function decodeWape(stored: Buffer, layout: WapeLayout): Buffer {
	const bits = new WapeBits(stored, HEADER_SIZE + 4);
	const pcm: Buffer = Buffer.alloc(layout.pcmSize, 0x00);
	let dst = 0;
	// A step of a change of the byte before it: the code's two bits choose the size and the direction.
	const change = (code: number, small: boolean): number =>
		small
			? 0xc0 === code
				? 4
				: 0x80 === code
					? 2
					: 0x40 === code
						? -2
						: -4
			: 0xc0 === code
				? 8
				: 0x80 === code
					? 6
					: 0x40 === code
						? -6
						: -8;
	while (dst < layout.pcmSize) {
		if (0 === bits.read(1)) {
			// A clear bit is a byte that stands itself, of the seven bits the reader can hold.
			pcm[dst] = bits.read(7);
			dst += 1;
		} else {
			// A set bit introduces a step: another clear one is a change of the byte before, and a set one
			// is followed by a third bit, which tells a larger change from a run of the byte before.
			const second = bits.read(1);
			if (0 === second) {
				if (dst === 0) {
					throw invalidSound(
						"TechnoBrain sound steps from before its own start",
					);
				}
				const previous = pcm[dst - 1] ?? 0;
				pcm[dst] = (previous + change(bits.read(2), true)) & 0xff;
				dst += 1;
			} else {
				const third = bits.read(1);
				if (0 === third) {
					if (dst === 0) {
						throw invalidSound(
							"TechnoBrain sound steps from before its own start",
						);
					}
					const previous = pcm[dst - 1] ?? 0;
					pcm[dst] = (previous + change(bits.read(2), false)) & 0xff;
					dst += 1;
				} else {
					if (dst === 0) {
						throw invalidSound(
							"TechnoBrain sound runs from before its own start",
						);
					}
					let count = bits.read(5) >> 3;
					// The five bits only reach three, so the reference's own escape for a longer run is never
					// taken; it is kept here as it stands.
					if (0x1f === count) count = bits.read(8) + 0x1f;
					count += 1;
					if (dst + count > pcm.length) {
						throw invalidSound("TechnoBrain sound writes past its own end");
					}
					pcm.fill(pcm[dst - 1] ?? 0, dst, dst + count);
					dst += count;
				}
			}
		}
		if (0xfe === pcm[dst - 1]) pcm[dst - 1] = 0xff;
	}
	return pcm;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const technoBrainWapeAudioDescriptor: FormatDescriptor = {
	id: "techno-brain-wape-audio",
	name: "TechnoBrain's compressed audio",
	extensions: ["wav"],
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
			source: "ArcFormats/TechnoBrain/AudioWAPE.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const technoBrainWapeAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: technoBrainWapeAudioDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(RIFF_MARK, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (
				header.subarray(0, 4).toString("latin1") !== RIFF_MARK ||
				header.subarray(8, 16).toString("latin1") !== FORMAT_MARK ||
				header
					.subarray(DATA_MARK_FIELD, DATA_MARK_FIELD + 4)
					.toString("latin1") !== DATA_MARK
			) {
				return false;
			}
			return (
				header.readInt32LE(PCM_SIZE_FIELD) > 0 &&
				header.readUInt16LE(CHANNELS_FIELD) > 0
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readWapeLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidSound("Not a TechnoBrain sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE + 4),
				size: BigInt(layout.dataLength),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					bitsPerSample: layout.bitsPerSample,
					pcmSize: layout.pcmSize,
				},
			}),
			// The samples are unfolded from the walk of bits and a wave header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "bits",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readWapeLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not a TechnoBrain sound");
		}
		const pcm = decodeWape(stored, layout);
		return Readable.from([
			writeWave(
				{
					formatTag: layout.formatTag,
					channels: layout.channels,
					sampleRate: layout.sampleRate,
					averageBytesPerSecond: layout.averageBytesPerSecond,
					blockAlign: layout.blockAlign,
					bitsPerSample: layout.bitsPerSample,
				},
				pcm,
			),
		]);
	},
});
