// Format reference: GARbro "Legacy/AyPio/AudioVOC.cs", classes `VocAudio` and `VocDecoder` (a UK2 engine
// sound: a walk of nibbles that steps a sample along by one of eighty nine steps of a table whose values are
// worked out from the bits of a sample, each step standing for the same places of the step table and the
// places of the sample already walked). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { type WavFormat, writeWave } from "../shared/wav.js";

/** 'WAV\x81', the word the reference registers. */
const SIGNATURE = Buffer.from([0x57, 0x41, 0x56, 0x81]);
const HEADER_SIZE = 0x3c;
/** The word `RIFF`, which stands behind the head of the file. */
const RIFF_MARK = Buffer.from("RIFF", "latin1");
const RIFF_FIELD = 0x38;
/** The channels of the sound, the number of its samples and the bits of a sample. */
const CHANNELS_FIELD = 0x08;
const SAMPLE_COUNT_FIELD = 0x18;
const BITS_FIELD = 0x20;
/** The first sample of the sound, in two halves, which the head carries. */
const FIRST_SAMPLE_FIELDS = [0x0a, 0x0b, 0x0e, 0x0f];
/** The step the walk of the two channels stands at, one for each. */
const PREVIOUS_FIELDS = [0x0c, 0x10];
/** The two parts of where the walk of the sound begins, which the head adds up. */
const DATA_FIELDS = [0x04, 0x14];
/** The shape of the sound, which stands behind the word `fmt ` of the head. */
const FORMAT_FIELD = 0x21;
/** How many steps the walk of the sound knows. */
const STEP_COUNT = 89;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** `VocDecoder.StepTable`: what a step of the walk stands for, before the bits of a sample are taken. */
const STEP_TABLE = new Uint16Array([
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

/** `VocDecoder.IndexTable`: how a step moves along the steps of the walk for the places of the sound. */
const INDEX_TABLE = new Int8Array([-1, -1, -1, -1, 1, 2, 3, 4]);

export interface VocLayout {
	/** The shape of the sound, which the head carries. */
	format: WavFormat;
	/** How many samples the sound holds. */
	sampleCount: number;
	channels: number;
	/** The bits of a sample, which say how many places every step of the walk is worked out for. */
	bitsPerSample: number;
	/** The step the walk of each channel stands at. */
	previous: [number, number];
	/** The first sample of the sound, in two halves. */
	first: [number, number];
	/** Where the walk of the sound begins. */
	dataOffset: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `VocDecoder`: the head of the file is thirty six bytes wide and carries the shape of the sound behind the
 * word `fmt ` at `0x1D` — the kind of the sound, the channels, the pace, the average, the size of a block and
 * the bits of a sample — together with how many samples the sound holds, the step the walk of each channel
 * stands at, the first sample of the sound and two parts of where the walk of the sound begins. The word
 * `RIFF` stands at `0x38`.
 */
export function readVocLayout(
	data: Buffer,
	fileLength = data.length,
): VocLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!data.subarray(RIFF_FIELD, RIFF_FIELD + RIFF_MARK.length).equals(RIFF_MARK)
	) {
		return undefined;
	}
	const sampleCount = data.readInt32LE(SAMPLE_COUNT_FIELD);
	if (sampleCount < 0 || sampleCount > LIMIT) return undefined;
	const channels = data[CHANNELS_FIELD] ?? 0;
	const bitsPerSample = data[BITS_FIELD] ?? 0;
	if (channels < 1 || bitsPerSample < 1 || bitsPerSample > 16) return undefined;
	if (sampleCount < channels) return undefined;
	const dataOffset =
		data.readUInt32LE(DATA_FIELDS[0] ?? 0) +
		data.readUInt32LE(DATA_FIELDS[1] ?? 0);
	if (dataOffset > fileLength) return undefined;
	return {
		format: {
			formatTag: data.readUInt16LE(FORMAT_FIELD),
			channels: data.readUInt16LE(FORMAT_FIELD + 2),
			sampleRate: data.readUInt32LE(FORMAT_FIELD + 4),
			averageBytesPerSecond: data.readUInt32LE(FORMAT_FIELD + 8),
			blockAlign: data.readUInt16LE(FORMAT_FIELD + 12),
			bitsPerSample: data.readUInt16LE(FORMAT_FIELD + 14),
		},
		sampleCount,
		channels,
		bitsPerSample,
		previous: [
			data[PREVIOUS_FIELDS[0] ?? 0] ?? 0,
			data[PREVIOUS_FIELDS[1] ?? 0] ?? 0,
		],
		first: [
			(data[FIRST_SAMPLE_FIELDS[0] ?? 0] ?? 0) |
				((data[FIRST_SAMPLE_FIELDS[1] ?? 0] ?? 0) << 8),
			(data[FIRST_SAMPLE_FIELDS[2] ?? 0] ?? 0) |
				((data[FIRST_SAMPLE_FIELDS[3] ?? 0] ?? 0) << 8),
		],
		dataOffset,
	};
}

/**
 * `VocDecoder.BuildSamples`: the steps of the walk are worked out for every place of a sample. A step stands
 * for what its own value in the step table gives, cut into as many parts as the bits of a sample name, and
 * every place of a sample takes the parts its own places name — which is the sum, over the parts of the step
 * table, of a part of it wherever the places of a sample that stand below that part say so.
 */
export function buildVocSamples(bitsPerSample: number): Int32Array {
	const places = 1 << (bitsPerSample - 1);
	const samples = new Int32Array(STEP_COUNT * places);
	for (let step = 0; step < STEP_COUNT; step += 1) {
		for (let place = 0; place < places; place += 1) {
			let value = 0;
			let part = 1;
			let parts = places;
			do {
				// The reference cuts the parts in two with whole numbers of them, not halves of one.
				if (place % part >= part >> 1) value += (STEP_TABLE[step] ?? 0) / parts;
				part <<= 1;
				parts >>= 1;
			} while (part <= places);
			samples[step + place * STEP_COUNT] = Math.trunc(value);
		}
	}
	return samples;
}

/** Where the walk of the sound stands: the byte it is reading and the nibbles it still holds. */
interface VocCursor {
	data: Buffer;
	position: number;
	/** How many nibbles the walk has taken. */
	source: number;
	/** The byte the walk holds, whose higher nibble stands behind the lower one. */
	current: number;
}

/**
 * `VocDecoder.GetSample`: the walk takes the lower nibble of a byte first and its higher nibble behind it,
 * which is what the reference's own walk does by cutting the byte it holds and taking a new one only every
 * other step.
 */
function nextNibble(cursor: VocCursor): number {
	if (0 === (cursor.source & 1)) {
		if (cursor.position >= cursor.data.length) {
			throw invalidSound("UK2 sound is cut short of its walk");
		}
		cursor.current = cursor.data[cursor.position] ?? 0;
		cursor.position += 1;
	}
	cursor.source += 1;
	const value = cursor.current;
	cursor.current >>= 4;
	return value & 0x0f;
}

function clamp16(value: number): number {
	if (value > 0x7fff) return 0x7fff;
	if (value < -0x8000) return -0x8000;
	return value;
}

/**
 * `VocDecoder.Decode`: the first sample of the sound stands in the head, and every step of the walk then
 * moves a sample along by what the steps of the walk give for the places of the nibble — the highest place of
 * the nibble saying whether the sample climbs or falls — and the sample stands at the very end of the sound
 * the walk writes, which is a step behind the one it read. The walk of a sound of two channels moves the
 * steps of the channel its place names along, and the last sample of every channel and the samples the walk
 * does not reach stand as nought.
 */
export function decodeVoc(data: Buffer, layout: VocLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.sampleCount * 2, 0x00);
	// The first sample of the sound stands in the head and not in the walk. A sound of fewer than two
	// samples cannot hold it, where the reference would write beyond its own array.
	if (output.length >= 2) output.writeUInt16LE(layout.first[0] & 0xffff, 0);
	if (output.length >= 4) output.writeUInt16LE(layout.first[1] & 0xffff, 2);
	const samples = buildVocSamples(layout.bitsPerSample);
	const previous: [number, number] = [layout.previous[0], layout.previous[1]];
	const cursor: VocCursor = {
		data,
		position: layout.dataOffset,
		source: 0,
		current: 0,
	};
	const count = layout.sampleCount - layout.channels;
	let position = 0;
	for (let index = 0; index < count; index += 1) {
		const value = nextNibble(cursor);
		const step = value & 7;
		const channel = layout.channels === 1 || 0 === (index & 1) ? 0 : 1;
		const at = previous[channel] ?? 0;
		let sample = samples[STEP_COUNT * step + at] ?? 0;
		if (0 !== (value & 8)) sample = -sample;
		sample += output.readInt16LE(position);
		position += 2;
		output.writeInt16LE(clamp16(sample), position);
		let next = (INDEX_TABLE[step] ?? -1) + at;
		if (next < 0) next = 0;
		else if (next > STEP_COUNT - 1) next = STEP_COUNT - 1;
		previous[channel] = next;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aypioVocAudioDescriptor: FormatDescriptor = {
	id: "aypio-voc-audio",
	name: "UK2 engine compressed audio",
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
			source: "Legacy/AyPio/AudioVOC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aypioVocAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aypioVocAudioDescriptor,
	// The reference registers the word `WAV\x81` and no name at all.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readVocLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readVocLayout(await readStored(source), Number(source.size));
		if (!layout) throw invalidSound("Not a UK2 engine sound");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "audio",
					channels: layout.format.channels,
					sampleRate: layout.format.sampleRate,
					bitsPerSample: layout.format.bitsPerSample,
				},
			}),
			// The samples are walked out and a wave header is written around them.
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				codec: "adpcm",
				channels: layout.format.channels,
				sampleRate: layout.format.sampleRate,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readVocLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a UK2 engine sound");
		return Readable.from([writeWave(layout.format, decodeVoc(stored, layout))]);
	},
});
