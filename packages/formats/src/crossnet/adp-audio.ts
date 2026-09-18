// Format reference: GARbro "Legacy/CrossNet/AudioADP.cs", classes `AdpAudio` and `AdpDecoder` (a wave file
// whose samples are the engine's own four bit ADPCM). GARbro commit
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";

/** 'RIFF', the mark of a wave file, and the only signature the reference registers. */
const SIGNATURE = Buffer.from("RIFF", "latin1");
const WAVE_MARK = "WAVEfmt ";
const HEADER_SIZE = 0x24;
const FORMAT_SIZE_FIELD = 0x10;
const CODEC_FIELD = 0x14;
const CHANNELS_FIELD = 0x16;
const SAMPLE_RATE_FIELD = 0x18;
/** The codec the reference insists on, which no standard wave carries. */
const CODEC = 0xffff;
const BITS_PER_SAMPLE = 16;
/** The two section names the walk knows; every other one is passed over. */
const DATA_SECTION = 0x61746164; // 'data'
const SHIFT_SECTION = 0x74666873; // 'shft'
const DEFAULT_SHIFT = 2;
const SECTION_HEADER_SIZE = 8;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** `AdpDecoder.QuantizeTable`, one step for every quantiser the walk may stand at. */
const QUANTIZE_TABLE = new Uint16Array([
	0x010, 0x011, 0x013, 0x015, 0x017, 0x019, 0x01c, 0x01f, 0x022, 0x025, 0x029,
	0x02d, 0x032, 0x037, 0x03c, 0x042, 0x049, 0x050, 0x058, 0x061, 0x06b, 0x076,
	0x082, 0x08f, 0x09d, 0x0ad, 0x0be, 0x0d1, 0x0e6, 0x0fd, 0x117, 0x133, 0x151,
	0x173, 0x198, 0x1c1, 0x1ee, 0x220, 0x256, 0x292, 0x2d4, 0x31c, 0x36c, 0x3c3,
	0x424, 0x48e, 0x502, 0x583, 0x610,
]);
/** `AdpDecoder.ScaleTable`: four steps up for every code up to seven, then four down again. */
const SCALE_TABLE = new Int8Array([
	1, 3, 5, 7, 9, 11, 13, 15, -1, -3, -5, -7, -9, -11, -13, -15,
]);
/** `AdpDecoder.IncrementTable`, how far the quantiser moves for every code. */
const INCREMENT_TABLE = new Int8Array([
	-1, -1, -1, -1, 2, 4, 6, 8, -1, -1, -1, -1, 2, 4, 6, 8,
]);
const MAXIMUM_QUANTIZER = 48;

export interface CrossNetAdpLayout {
	sampleRate: number;
	channels: number;
	/** How far the scaled sample steps, which the `shft` section may change. */
	shift: number;
	/** The count the walk runs down two at a time, which is not the count of samples written. */
	samples: number;
	dataOffset: number;
	dataSize: number;
	/** The bytes of the stream the walk reads. */
	dataLength: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `AdpAudio.TryOpen`: the file has to be a wave of the `RIFF` mark whose name ends in `.adp`, with the
 * `WAVEfmt ` mark at eight, a format size at `0x10`, the codec `0xFFFF` at `0x14`, one or two channels at
 * `0x16` and the sample rate at `0x18`. The sections then begin at `0x14` plus the format size: every one
 * of them carries its own name and size, `shft` says how far the scaled sample steps, and the walk ends at
 * `data`, whose size sets the count the samples are walked by. A missing `shft` section leaves the step at
 * two, and a negative one is a step of two as well.
 */
export function readCrossNetAdpLayout(
	data: Buffer,
	fileLength = data.length,
): CrossNetAdpLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (data.subarray(8, 16).toString("latin1") !== WAVE_MARK) return undefined;
	if (
		data.readUInt16LE(CODEC_FIELD) !== CODEC ||
		data.readUInt32LE(FORMAT_SIZE_FIELD) > fileLength
	) {
		return undefined;
	}
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels !== 1 && channels !== 2) return undefined;
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	let shift = DEFAULT_SHIFT;
	let sectionOffset = 0x14 + data.readUInt32LE(FORMAT_SIZE_FIELD);
	let dataOffset = -1;
	let dataSize = 0;
	for (;;) {
		if (sectionOffset + SECTION_HEADER_SIZE > fileLength) return undefined;
		const id = data.readUInt32LE(sectionOffset);
		const size = data.readUInt32LE(sectionOffset + SECTION_HEADER_SIZE - 4);
		if (DATA_SECTION === id) {
			dataOffset = sectionOffset + SECTION_HEADER_SIZE;
			dataSize = size;
			break;
		}
		if (SHIFT_SECTION === id) {
			if (sectionOffset + SECTION_HEADER_SIZE + 4 > fileLength) {
				return undefined;
			}
			shift = data.readInt32LE(sectionOffset + SECTION_HEADER_SIZE);
		}
		// Sections are padded to an even length.
		sectionOffset += SECTION_HEADER_SIZE + ((size + 1) & ~1);
	}
	if (shift < 0) shift = DEFAULT_SHIFT;
	const samples = Math.trunc((2 * dataSize) / channels);
	if (samples <= 0 || samples * 2 * channels > LIMIT) return undefined;
	const dataLength = channels * Math.ceil(samples / 2);
	if (dataOffset + dataLength > fileLength) return undefined;
	return {
		sampleRate,
		channels,
		shift,
		samples,
		dataOffset,
		dataSize,
		dataLength,
	};
}

/**
 * `AdpDecoder`: one step of the engine's own ADPCM. The quantiser is taken before it moves, the step is the
 * quantiser scaled by the code's own entry of the scale table and shifted by the section's own step, and the
 * sample is kept within a signed word. The quantiser itself is kept within the table's bounds.
 */
export class CrossNetAdpDecoder {
	#previous = 0;
	#quantizer = 0;
	readonly #shift: number;

	constructor(shift: number) {
		this.#shift = shift;
	}

	decode(code: number): number {
		const nibble = code & 0x0f;
		const quant = QUANTIZE_TABLE[this.#quantizer] ?? 0;
		const scaled = ((SCALE_TABLE[nibble] ?? 0) * quant) << this.#shift;
		let sample = scaled + this.#previous;
		if (sample < -32768) sample = -32768;
		else if (sample > 0x7fff) sample = 0x7fff;
		this.#quantizer += INCREMENT_TABLE[nibble] ?? 0;
		if (this.#quantizer < 0) this.#quantizer = 0;
		else if (this.#quantizer > MAXIMUM_QUANTIZER) {
			this.#quantizer = MAXIMUM_QUANTIZER;
		}
		this.#previous = sample;
		return sample;
	}
}

/**
 * `AdpAudio.TryOpen`'s walk. A sound of one channel has the **lower** nibble of a byte decoded first and the
 * higher behind it, both by the same walk; a sound of two channels gives a whole byte to each walk in turn,
 * so the two samples of a frame stand in the order left, right.
 */
export function decodeCrossNetAdp(
	stored: Buffer,
	layout: CrossNetAdpLayout,
): Buffer {
	const output: Buffer = Buffer.alloc(
		layout.samples * 2 * layout.channels,
		0x00,
	);
	const write = (at: number, value: number): void => {
		if (at + 2 > output.length) {
			throw invalidSound("CrossNet sound writes past its own end");
		}
		output.writeInt16LE(value & 0xffff, at);
	};
	let source = layout.dataOffset;
	const readByte = (): number => {
		if (source >= stored.length) {
			throw invalidSound("CrossNet sound is cut short of its stream");
		}
		const value = stored[source] ?? 0;
		source += 1;
		return value;
	};
	const first = new CrossNetAdpDecoder(layout.shift);
	let samples = layout.samples;
	let dst = 0;
	if (1 === layout.channels) {
		while (samples > 0) {
			const value = readByte();
			write(dst, first.decode(value));
			write(dst + 2, first.decode(value >> 4));
			dst += 4;
			samples -= 2;
		}
	} else {
		const second = new CrossNetAdpDecoder(layout.shift);
		while (samples > 0) {
			const left = readByte();
			write(dst, first.decode(left));
			write(dst + 4, first.decode(left >> 4));
			const right = readByte();
			write(dst + 2, second.decode(right));
			write(dst + 6, second.decode(right >> 4));
			dst += 8;
			samples -= 2;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const crossNetAdpAudioDescriptor: FormatDescriptor = {
	id: "crossnet-adp-audio",
	name: "CrossNet ADPCM-compressed audio",
	extensions: ["adp"],
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
			source: "Legacy/CrossNet/AudioADP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const crossNetAdpAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crossNetAdpAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		// The reference also asks for the name to end in `.adp`, which is what tells a wave of this codec
		// from every other wave.
		if (sourceExtension(sourcePath) !== "adp") return false;
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (
				!header.subarray(0, SIGNATURE.length).equals(SIGNATURE) ||
				header.subarray(8, 16).toString("latin1") !== WAVE_MARK ||
				header.readUInt16LE(CODEC_FIELD) !== CODEC
			) {
				return false;
			}
			return (
				readCrossNetAdpLayout(await readStored(source), Number(source.size)) !==
				undefined
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readCrossNetAdpLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidSound("Not a CrossNet sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					shift: layout.shift,
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
		const layout = readCrossNetAdpLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not a CrossNet sound");
		}
		const pcm = decodeCrossNetAdp(stored, layout);
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
