// Format reference: GARbro "ArcFormats/Marble/AudioWADY.cs", classes `WadyAudio` and `WadyInput` (a Marble
// engine sound whose samples stand either as a walk of one byte each or as a walk of runs that stand between
// two samples). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'WADY', the word the reference registers. */
const SIGNATURE = Buffer.from("WADY", "latin1");
/** What a stepped sample is multiplied by. */
const MULTIPLIER_FIELD = 0x05;
/** The size of the samples the head names. */
const SOURCE_SIZE_FIELD = 0x0c;
/** The shape of the sound, which the head carries behind its own fields. */
const FORMAT_FIELD = 0x20;
const HEADER_SIZE = 0x30;
/** Where a sound of two channels keeps the size of the second channel, which stands from `0x38`. */
const SECOND_CHANNEL_FIELD = 0x38;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** `WadyInput.SizeTable`: how many samples a run of the walk of runs gives. */
const SIZE_TABLE = new Uint16Array([3, 4, 5, 6, 8, 0x10, 0x20, 0x100]);
/** `WadyInput.SampleTable`: what a step of the walk of one byte each adds to a sample, by its lower places. */
const SAMPLE_TABLE = new Uint16Array([
	0x0000, 0x0002, 0x0004, 0x0006, 0x0008, 0x000a, 0x000c, 0x000f, 0x0012,
	0x0015, 0x0018, 0x001c, 0x0020, 0x0024, 0x0028, 0x002c, 0x0031, 0x0036,
	0x003b, 0x0040, 0x0046, 0x004c, 0x0052, 0x0058, 0x005f, 0x0066, 0x006d,
	0x0074, 0x007c, 0x0084, 0x008c, 0x0094, 0x00a0, 0x00aa, 0x00b4, 0x00be,
	0x00c8, 0x00d2, 0x00dc, 0x00e6, 0x00f0, 0x00ff, 0x010e, 0x011d, 0x012c,
	0x0140, 0x0154, 0x0168, 0x017c, 0x0190, 0x01a9, 0x01c2, 0x01db, 0x01f4,
	0x020d, 0x0226, 0x0244, 0x0262, 0x028a, 0x02bc, 0x02ee, 0x0320, 0x0384,
	0x03e8, 0x0000, 0xfffe, 0xfffc, 0xfffa, 0xfff8, 0xfff6, 0xfff4, 0xfff1,
	0xffee, 0xffeb, 0xffe8, 0xffe4, 0xffe0, 0xffdc, 0xffd8, 0xffd4, 0xffcf,
	0xffca, 0xffc5, 0xffc0, 0xffba, 0xffb4, 0xffae, 0xffa8, 0xffa1, 0xff9a,
	0xff93, 0xff8c, 0xff84, 0xff7c, 0xff74, 0xff6c, 0xff60, 0xff56, 0xff4c,
	0xff42, 0xff38, 0xff2e, 0xff24, 0xff1a, 0xff10, 0xff01, 0xfef2, 0xfee3,
	0xfed4, 0xfec0, 0xfeac, 0xfe98, 0xfe84, 0xfe70, 0xfe57, 0xfe3e, 0xfe25,
	0xfe0c, 0xfdf3, 0xfdda, 0xfdbc, 0xfd9e, 0xfd76, 0xfd44, 0xfd12, 0xfce0,
	0xfc7c, 0xfc18,
]);
/** `WadyInput.SampleTable2`: what a step of the walk of runs adds to a sample, by its lower places. */
const SAMPLE_TABLE2 = new Uint16Array([
	0x0000, 0x0004, 0x0008, 0x000c, 0x0013, 0x0018, 0x001e, 0x0026, 0x002f,
	0x003b, 0x004a, 0x005c, 0x0073, 0x0090, 0x00b4, 0x00e1, 0x0119, 0x0160,
	0x01b8, 0x0226, 0x02af, 0x035b, 0x0431, 0x053e, 0x068e, 0x0831, 0x0a3d,
	0x0ccd, 0x1000, 0x1400, 0x1900, 0x1f40, 0x0000, 0xfffc, 0xfff8, 0xfff4,
	0xffed, 0xffe8, 0xffe2, 0xffda, 0xffd1, 0xffc5, 0xffb6, 0xffa4, 0xff8d,
	0xff70, 0xff4c, 0xff1f, 0xfee7, 0xfea0, 0xfe48, 0xfdda, 0xfd51, 0xfca5,
	0xfbcf, 0xfac2, 0xf972, 0xf7cf, 0xf5c3, 0xf333, 0xf000, 0xec00, 0xe700,
	0xe0c0,
]);

export interface WadyLayout {
	/** What every step of the walk adds, multiplied by the table of steps. */
	multiplier: number;
	/** The size of the samples the head names. */
	sourceSize: number;
	/** The shape of the sound, which the head carries. */
	format: WavFormat;
	/** Whether the samples stand as a walk of one byte each, or as a walk of runs. */
	plain: boolean;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** The places of the file the walk stands at. */
interface WadyCursor {
	data: Buffer;
	position: number;
}

function readByte(cursor: WadyCursor): number {
	if (cursor.position >= cursor.data.length) {
		throw invalidSound("Marble sound is cut short of its walk");
	}
	const value = cursor.data[cursor.position] ?? 0;
	cursor.position += 1;
	return value;
}

function readInt16(cursor: WadyCursor): number {
	const value = (readByte(cursor) | (readByte(cursor) << 8)) & 0xffff;
	return (value << 16) >> 16;
}

function readInt32(cursor: WadyCursor): number {
	const value =
		readByte(cursor) |
		(readByte(cursor) << 8) |
		(readByte(cursor) << 16) |
		(readByte(cursor) << 24);
	return value | 0;
}

/**
 * `WadyInput`: the first word is the word the reference registers, the byte at five is what every step of the
 * walk is multiplied by, the size of the samples stands at `0x0C` and the shape of the sound stands at
 * `0x20` — the kind of the sound, the channels, the pace, the average, the size of a block and the bits of a
 * sample. The samples themselves stand from `0x30`.
 *
 * The reference walks the samples one byte at a time where the size the head names is the very size of what
 * stands behind the head, and otherwise walks runs of samples.
 */
export function readWadyLayout(
	data: Buffer,
	fileLength = data.length,
): WadyLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const sourceSize = data.readInt32LE(SOURCE_SIZE_FIELD);
	if (sourceSize < 0 || sourceSize > LIMIT) return undefined;
	const format: WavFormat = {
		formatTag: data.readUInt16LE(FORMAT_FIELD),
		channels: data.readUInt16LE(FORMAT_FIELD + 2),
		sampleRate: data.readUInt32LE(FORMAT_FIELD + 4),
		averageBytesPerSecond: data.readUInt32LE(FORMAT_FIELD + 8),
		blockAlign: data.readUInt16LE(FORMAT_FIELD + 12),
		bitsPerSample: data.readUInt16LE(FORMAT_FIELD + 14),
	};
	if (format.channels < 1) return undefined;
	return {
		multiplier: data[MULTIPLIER_FIELD] ?? 0,
		sourceSize,
		format,
		plain: fileLength - HEADER_SIZE === sourceSize,
	};
}

/** Where the walk of the sound writes its samples: the reference writes into a stream that grows. */
interface WadyWriter {
	data: Buffer;
	/** How many bytes of the sound stand there, which is what the reference calls the size of its stream. */
	used: number;
	position: number;
}

function createWriter(capacity: number): WadyWriter {
	return {
		data: Buffer.alloc(Math.max(capacity, 0x100), 0x00),
		used: 0,
		position: 0,
	};
}

function writeSample(writer: WadyWriter, value: number): void {
	const end = writer.position + 2;
	if (end > writer.data.length) {
		const grown = Buffer.alloc(Math.max(end, writer.data.length * 2), 0x00);
		writer.data.copy(grown, 0, 0, writer.used);
		writer.data = grown;
	}
	// A gap the walk has stepped over stands as nought, which is what the reference's own stream leaves there.
	if (end > writer.used) writer.used = end;
	writer.data.writeUInt16LE(value & 0xffff, writer.position);
	writer.position = end;
}

/**
 * `WadyInput.Decode`: every byte of the walk gives one sample of the left channel and — where the sound has
 * more than one channel — one more byte gives a sample of the right channel, the two standing side by side.
 * A byte whose highest place stands is a sample of its own, standing ten places to the left; any other byte
 * moves the sample along by the value of the walk multiplied by the table of steps, which may also fall.
 */
function walkSamples(cursor: WadyCursor, layout: WadyLayout): Buffer {
	const writer = createWriter(layout.sourceSize * 2);
	const stereo = 1 !== layout.format.channels;
	let sampleLeft = 0;
	let sampleRight = 0;
	const step = (sample: number, value: number): number => {
		if (0 !== (value & 0x80)) return (value << 9) & 0xffff;
		return (sample + layout.multiplier * (SAMPLE_TABLE[value] ?? 0)) & 0xffff;
	};
	for (let index = 0; index < layout.sourceSize; index += 1) {
		sampleLeft = step(sampleLeft, readByte(cursor));
		writeSample(writer, sampleLeft);
		if (stereo) {
			// The walk of a sound of two channels reads the two of them a pair at a time.
			index += 1;
			sampleRight = step(sampleRight, readByte(cursor));
			writeSample(writer, sampleRight);
		}
	}
	return writer.data.subarray(0, writer.used);
}

/**
 * `WadyInput.Decode3`: the walk begins with a sample of its own and then takes an item at a time. An item
 * whose lowest place stands moves the sample along by what the second table of steps gives for its lower
 * places, or stands a sample of its own where the places above name it; any other item stands between the
 * sample at hand and the sample its higher places name, `SizeTable` saying how many samples stand between
 * them. Where the walk is one of two channels, it leaves the other channel's room by stepping over a sample
 * every time it writes one.
 */
function walkRuns(
	cursor: WadyCursor,
	writer: WadyWriter,
	channelStep: number,
): void {
	// The size of the sound the walk gives, which the reference reads and does not use.
	readInt32(cursor);
	const count = readInt32(cursor);
	let sample = readInt16(cursor);
	writeSample(writer, sample);
	for (let index = 0; index < count; index += 1) {
		if (count - 300 === index) sample = 0;
		let value = readByte(cursor);
		if (0 !== (value & 1)) {
			const code = (value >> 1) & 0x7f;
			if (0 !== (code & 0x40)) sample = ((code << 10) << 16) >> 16;
			else sample = ((sample + (SAMPLE_TABLE2[code] ?? 0)) << 16) >> 16;
			writeSample(writer, sample);
			if (0 !== channelStep) writer.position += channelStep;
		} else {
			value |= readByte(cursor) << 8;
			const repeat = SIZE_TABLE[(value >> 1) & 7] ?? 0;
			const end = ((value & 0xfff0) << 16) >> 16;
			const increment = (end - sample) / repeat;
			let walked = sample;
			for (let step = 0; step < repeat; step += 1) {
				walked += increment;
				writeSample(writer, (Math.trunc(walked) << 16) >> 16);
				if (0 !== channelStep) writer.position += channelStep;
			}
			sample = end;
		}
	}
}

/**
 * `WadyInput.Decode2`: a sound of one channel walks its runs as they stand; a sound of two channels keeps the
 * size of its second channel in the four bytes at `0x30`, walks the left channel first and then the right one,
 * which stands at `0x38` and as far along as that size says, the two of them standing side by side in the
 * sound.
 */
export function decodeWady(data: Buffer, layout: WadyLayout): Buffer {
	const cursor: WadyCursor = { data, position: HEADER_SIZE };
	if (layout.plain) return walkSamples(cursor, layout);
	if (1 !== layout.format.channels) {
		const channelSize = readInt32(cursor);
		const writer = createWriter(0x100);
		walkRuns(cursor, writer, 2);
		cursor.position = SECOND_CHANNEL_FIELD + channelSize;
		writer.position = 2;
		walkRuns(cursor, writer, 2);
		return writer.data.subarray(0, writer.used);
	}
	const writer = createWriter(0x100);
	walkRuns(cursor, writer, 0);
	return writer.data.subarray(0, writer.used);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const marbleWadyAudioDescriptor: FormatDescriptor = {
	id: "marble-way-audio",
	name: "Marble engine wave audio format",
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
			source: "ArcFormats/Marble/AudioWADY.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const marbleWadyAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: marbleWadyAudioDescriptor,
	// The reference registers the word `WADY` and no name at all.
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readWadyLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readWadyLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) throw invalidSound("Not a Marble engine sound");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
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
		const layout = readWadyLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a Marble engine sound");
		return Readable.from([
			writeWave(layout.format, decodeWady(stored, layout)),
		]);
	},
});
