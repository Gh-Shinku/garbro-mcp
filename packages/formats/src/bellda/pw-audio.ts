// Format reference: GARbro "ArcFormats/BellDa/AudioPW.cs", class `PwAudio` (a wave file whose samples are
// one byte each, standing for a word of a table the reference carries). GARbro commit
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
import { writeWave, type WavFormat } from "../shared/wav.js";

/** 'PW10', the format signature as a little endian word. */
const SIGNATURE = Buffer.from("PW10", "latin1");
const HEADER_SIZE = 0x14;
/** The two chunks the reference walks: the format and the samples. */
const FORMAT_TAG_FIELD = 0xc;
const FORMAT_SIZE_FIELD = 0x10;
const FORMAT_TAG = Buffer.from("fmt ", "latin1");
const DATA_TAG = Buffer.from("data", "latin1");
const DATA_SIZE_BEHIND = 4;
const CHUNK_HEADER = 8;
/** The fields of the format chunk. */
const WAVE_FORMAT_TAG_FIELD = 0x14;
const CHANNELS_FIELD = 0x16;
const SAMPLE_RATE_FIELD = 0x18;
const BLOCK_ALIGN_FIELD = 0x20;
const BITS_PER_SAMPLE = 16;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface PwLayout {
	format: WavFormat;
	/** Where the one byte samples stand and how many of them there are. */
	sampleOffset: number;
	sampleCount: number;
}

function invalidAudio(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PwAudio.TryOpen`: the word `PW10` opens a wave file of its own; the format chunk stands at `0x0C` with its
 * size at `0x10`, and the samples chunk behind it. Every stored sample is one byte, which the table turns
 * into a sixteen bit word, so the block of a channel is twice the one the format declares and every sample is
 * sixteen bits wide. The average of bytes a second is what the reference's own `SetBPS` builds from the rate,
 * the channels and the depth.
 */
export function readPwLayout(data: Buffer): PwLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.subarray(FORMAT_TAG_FIELD, FORMAT_TAG_FIELD + 4).toString("latin1") !==
		"fmt "
	)
		return undefined;
	const formatSize = data.readInt32LE(FORMAT_SIZE_FIELD);
	if (formatSize < 0) return undefined;
	const dataTag = HEADER_SIZE + formatSize;
	if (dataTag + CHUNK_HEADER > data.length) return undefined;
	if (data.subarray(dataTag, dataTag + 4).toString("latin1") !== "data")
		return undefined;
	const sampleCount = data.readInt32LE(dataTag + DATA_SIZE_BEHIND);
	if (sampleCount < 0) return undefined;
	const sampleOffset = dataTag + CHUNK_HEADER;
	if (sampleOffset + sampleCount > data.length) return undefined;
	const size = sampleCount * 2;
	if (!Number.isSafeInteger(size) || size > LIMIT) return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	const blockAlign = data.readUInt16LE(BLOCK_ALIGN_FIELD) * 2;
	return {
		format: {
			formatTag: data.readUInt16LE(WAVE_FORMAT_TAG_FIELD),
			channels,
			sampleRate,
			averageBytesPerSecond: (sampleRate * channels * BITS_PER_SAMPLE) / 8,
			blockAlign,
			bitsPerSample: BITS_PER_SAMPLE,
		},
		sampleOffset,
		sampleCount,
	};
}

/**
 * `PwAudio.TryOpen`: every stored byte is the place of a word in the reference's own table, packed little
 * endian. A stream that stops before the samples it declares leaves the rest of the sound at nothing, which
 * is how the reference's own read behaves.
 */
export function decodePw(data: Buffer, layout: PwLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.sampleCount * 2, 0x00);
	for (let index = 0; index < layout.sampleCount; index += 1) {
		const position = layout.sampleOffset + index;
		if (position >= data.length) break;
		output.writeUInt16LE(PCM_TABLE[data[position] ?? 0] ?? 0, index * 2);
	}
	return output;
}

/** The table the reference carries: two hundred and fifty six words that climb and then fall. */
export const PCM_TABLE: readonly number[] = [
	0x8000, 0x8001, 0x8786, 0x8e99, 0x9542, 0x9b87, 0xa16e, 0xa6fc, 0xac37,
	0xb123, 0xb5c5, 0xba22, 0xbe3c, 0xc21a, 0xc5bd, 0xc929, 0xcc62, 0xcf6b,
	0xd246, 0xd4f6, 0xd77e, 0xd9df, 0xdc1d, 0xde39, 0xe036, 0xe215, 0xe3d7,
	0xe57f, 0xe70e, 0xe886, 0xe9e8, 0xeb35, 0xec6e, 0xed95, 0xeeab, 0xefb0,
	0xf0a6, 0xf18e, 0xf268, 0xf335, 0xf3f6, 0xf4ac, 0xf557, 0xf5f8, 0xf690,
	0xf71f, 0xf7a5, 0xf823, 0xf89a, 0xf90a, 0xf974, 0xf9d7, 0xfa35, 0xfa8d,
	0xfadf, 0xfb2d, 0xfb77, 0xfbbc, 0xfbfd, 0xfc3a, 0xfc74, 0xfcaa, 0xfcdd,
	0xfd0d, 0xfd3a, 0xfd65, 0xfd8d, 0xfdb2, 0xfdd6, 0xfdf7, 0xfe17, 0xfe34,
	0xfe50, 0xfe6a, 0xfe83, 0xfe9a, 0xfeb0, 0xfec5, 0xfed8, 0xfeea, 0xfefc,
	0xff0c, 0xff1b, 0xff29, 0xff37, 0xff44, 0xff4f, 0xff5b, 0xff65, 0xff6f,
	0xff79, 0xff81, 0xff8a, 0xff92, 0xff99, 0xffa0, 0xffa6, 0xffad, 0xffb2,
	0xffb8, 0xffbd, 0xffc2, 0xffc6, 0xffcb, 0xffcf, 0xffd2, 0xffd6, 0xffd9,
	0xffdc, 0xffdf, 0xffe2, 0xffe5, 0xffe7, 0xffea, 0xffec, 0xffee, 0xfff0,
	0xfff2, 0xfff3, 0xfff5, 0xfff7, 0xfff8, 0xfff9, 0xfffb, 0xfffc, 0xfffd,
	0xfffe, 0xffff, 0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0007,
	0x0008, 0x0009, 0x000b, 0x000d, 0x000e, 0x0010, 0x0012, 0x0014, 0x0016,
	0x0019, 0x001b, 0x001e, 0x0021, 0x0024, 0x0027, 0x002a, 0x002e, 0x0031,
	0x0035, 0x003a, 0x003e, 0x0043, 0x0048, 0x004e, 0x0053, 0x005a, 0x0060,
	0x0067, 0x006e, 0x0076, 0x007f, 0x0087, 0x0091, 0x009b, 0x00a5, 0x00b1,
	0x00bc, 0x00c9, 0x00d7, 0x00e5, 0x00f4, 0x0104, 0x0116, 0x0128, 0x013b,
	0x0150, 0x0166, 0x017d, 0x0196, 0x01b0, 0x01cc, 0x01e9, 0x0209, 0x022a,
	0x024e, 0x0273, 0x029b, 0x02c6, 0x02f3, 0x0323, 0x0356, 0x038c, 0x03c6,
	0x0403, 0x0444, 0x0489, 0x04d3, 0x0521, 0x0573, 0x05cb, 0x0629, 0x068c,
	0x06f6, 0x0766, 0x07dd, 0x085b, 0x08e1, 0x0970, 0x0a08, 0x0aa9, 0x0b54,
	0x0c0a, 0x0ccb, 0x0d98, 0x0e72, 0x0f5a, 0x1050, 0x1155, 0x126b, 0x1392,
	0x14cb, 0x1618, 0x177a, 0x18f2, 0x1a81, 0x1c29, 0x1deb, 0x1fca, 0x21c7,
	0x23e3, 0x2621, 0x2882, 0x2b0a, 0x2dba, 0x3095, 0x339e, 0x36d7, 0x3a43,
	0x3de6, 0x41c4, 0x45de, 0x4a3b, 0x4edd, 0x53c9, 0x5904, 0x5e92, 0x6479,
	0x6abe, 0x7167, 0x787a, 0x7fff,
];

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const bellDaPwAudioDescriptor: FormatDescriptor = {
	id: "bell-da-pw-audio",
	name: "BELL-DA compressed WAVE audio",
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
			source: "ArcFormats/BellDa/AudioPW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bellDaPwAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bellDaPwAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
		return readPwLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readPwLayout(await readStored(source));
		if (!layout) {
			throw invalidAudio("Not a BELL-DA compressed sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.sampleOffset),
				size: source.size - BigInt(layout.sampleOffset),
				compressed: true,
				metadata: { type: "audio" },
			}),
			// The samples are reserialised as a wave file, which need not be the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
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
		const layout = readPwLayout(stored);
		if (!layout) {
			throw invalidAudio("Not a BELL-DA compressed sound");
		}
		return Readable.from([writeWave(layout.format, decodePw(stored, layout))]);
	},
});
