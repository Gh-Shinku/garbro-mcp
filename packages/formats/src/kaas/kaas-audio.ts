// Format reference: GARbro "ArcFormats/Kaas/AudioKAAS.cs", classes `KaasAudio` and its own sample table
// (a KAAS engine sound of a byte a sample, every byte standing for a word of the table). GARbro commit
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

const HEADER_SIZE = 0x10;
/** The count of samples stands at nought, a word of `0x800` at four, the channels at six, the rate at eight
 *  and a word of its own at twelve. */
const LENGTH_FIELD = 0x00;
const MARK_FIELD = 0x04;
const CHANNELS_FIELD = 0x06;
const SAMPLE_RATE_FIELD = 0x08;
const MAGIC_FIELD = 0x0c;
const MARK = 0x800;
const MAGIC = 0x84be2329;
const BITS_PER_SAMPLE = 16;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

/** `KaasAudio.SampleTable`, the word every byte of the stream stands for. */
const SAMPLE_TABLE = new Uint16Array([
	0x0000, 0x0001, 0x0007, 0x0011, 0x001f, 0x0031, 0x0047, 0x0061, 0x007e,
	0x00a0, 0x00c6, 0x00ef, 0x011d, 0x014e, 0x0184, 0x01bd, 0x01fa, 0x023c,
	0x0281, 0x02ca, 0x0318, 0x0369, 0x03be, 0x0417, 0x0474, 0x04d5, 0x053a,
	0x05a3, 0x0610, 0x0681, 0x06f6, 0x076e, 0x07eb, 0x086c, 0x08f0, 0x0979,
	0x0a06, 0x0a96, 0x0b2b, 0x0bc3, 0x0c60, 0x0d00, 0x0da4, 0x0e4d, 0x0ef9,
	0x0fa9, 0x105d, 0x1115, 0x11d1, 0x1291, 0x1356, 0x141d, 0x14e9, 0x15b9,
	0x168d, 0x1765, 0x1841, 0x1921, 0x1a04, 0x1aec, 0x1bd8, 0x1cc7, 0x1dbb,
	0x1eb2, 0x1fae, 0x20ad, 0x21b0, 0x22b8, 0x23c3, 0x24d2, 0x25e6, 0x26fd,
	0x2818, 0x2937, 0x2a5a, 0x2b81, 0x2cac, 0x2ddb, 0x2f0e, 0x3045, 0x3180,
	0x32be, 0x3401, 0x3548, 0x3692, 0x37e1, 0x3934, 0x3a8a, 0x3be5, 0x3d43,
	0x3ea6, 0x400c, 0x4176, 0x42e5, 0x4457, 0x45cd, 0x4747, 0x48c5, 0x4a47,
	0x4bcd, 0x4d58, 0x4ee5, 0x5077, 0x520d, 0x53a7, 0x5545, 0x56e7, 0x588d,
	0x5a36, 0x5be4, 0x5d96, 0x5f4b, 0x6105, 0x62c2, 0x6484, 0x6649, 0x6812,
	0x69e0, 0x6bb1, 0x6d86, 0x6f60, 0x713d, 0x731e, 0x7503, 0x76ec, 0x78d9,
	0x7aca, 0x7cbf, 0xffff, 0xfffe, 0xfff8, 0xffee, 0xffe0, 0xffce, 0xffb8,
	0xff9e, 0xff81, 0xff5f, 0xff39, 0xff10, 0xfee2, 0xfeb1, 0xfe7b, 0xfe42,
	0xfe05, 0xfdc3, 0xfd7e, 0xfd35, 0xfce7, 0xfc96, 0xfc41, 0xfbe8, 0xfb8b,
	0xfb2a, 0xfac5, 0xfa5c, 0xf9ef, 0xf97e, 0xf909, 0xf891, 0xf814, 0xf793,
	0xf70f, 0xf686, 0xf5f9, 0xf569, 0xf4d4, 0xf43c, 0xf39f, 0xf2ff, 0xf25b,
	0xf1b2, 0xf106, 0xf056, 0xefa2, 0xeeea, 0xee2e, 0xed6e, 0xeca9, 0xebe2,
	0xeb16, 0xea46, 0xe972, 0xe89a, 0xe7be, 0xe6de, 0xe5fb, 0xe513, 0xe427,
	0xe338, 0xe244, 0xe14d, 0xe051, 0xdf52, 0xde4f, 0xdd47, 0xdc3c, 0xdb2d,
	0xda19, 0xd902, 0xd7e7, 0xd6c8, 0xd5a5, 0xd47e, 0xd353, 0xd224, 0xd0f1,
	0xcfba, 0xce7f, 0xcd41, 0xcbfe, 0xcab7, 0xc96d, 0xc81e, 0xc6cb, 0xc575,
	0xc41a, 0xc2bc, 0xc159, 0xbff3, 0xbe89, 0xbd1a, 0xbba8, 0xba32, 0xb8b8,
	0xb73a, 0xb5b8, 0xb432, 0xb2a7, 0xb11a, 0xaf88, 0xadf2, 0xac58, 0xaaba,
	0xa918, 0xa772, 0xa5c9, 0xa41b, 0xa269, 0xa0b4, 0x9efa, 0x9d3d, 0x9b7b,
	0x99b6, 0x97ed, 0x961f, 0x944e, 0x9279, 0x909f, 0x8ec2, 0x8ce1, 0x8afc,
	0x8913, 0x8726, 0x8535, 0x8340,
]);

export interface KaasLayout {
	/** How many bytes of the table the stream holds. */
	samples: number;
	channels: number;
	sampleRate: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `KaasAudio.TryOpen`: the count of samples stands at nought as a word, the word `0x800` at four, the channel
 * count at six — of which nought and one are read, standing for one and two channels — the sample rate at
 * eight, and the word `0x84BE2329` at twelve. The file has to hold exactly the bytes the count declares
 * behind its own head.
 */
export function readKaasLayout(
	data: Buffer,
	fileLength = data.length,
): KaasLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const length = data.readInt32LE(LENGTH_FIELD);
	if (data.readUInt16LE(MARK_FIELD) !== MARK) return undefined;
	if (BigInt(fileLength) !== BigInt(length) + BigInt(HEADER_SIZE)) {
		return undefined;
	}
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels > 1) return undefined;
	if (length <= 0 || length * 2 > LIMIT) return undefined;
	if (data.readUInt32LE(MAGIC_FIELD) !== MAGIC) return undefined;
	return {
		samples: length,
		channels: channels + 1,
		sampleRate: data.readUInt32LE(SAMPLE_RATE_FIELD),
	};
}

/**
 * `KaasAudio.TryOpen`'s walk: every byte of the stream is a word of the table, handed out as a sample of its
 * own, so the sound is twice as many bytes as the stream holds.
 */
export function decodeKaas(stored: Buffer, layout: KaasLayout): Buffer {
	const output: Buffer = Buffer.alloc(layout.samples * 2, 0x00);
	for (let index = 0; index < layout.samples; index += 1) {
		const byte = stored[HEADER_SIZE + index] ?? 0;
		output.writeUInt16LE(SAMPLE_TABLE[byte] ?? 0, index * 2);
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const kaasAudioDescriptor: FormatDescriptor = {
	id: "kaas-audio",
	name: "KAAS engine audio format",
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
			source: "ArcFormats/Kaas/AudioKAAS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kaasAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaasAudioDescriptor,
	// The reference registers no signature at all, so the head alone tells a sound of this engine from others;
	// the format is tried after the ones that carry a signature of their own.
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readKaasLayout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readKaasLayout(
			await readStored(source),
			Number(source.size),
		);
		if (!layout) {
			throw invalidSound("Not a KAAS sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(layout.samples),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					samples: layout.samples,
					bitsPerSample: BITS_PER_SAMPLE,
				},
			}),
			// The samples are unfolded from the table and a wave header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "table",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readKaasLayout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not a KAAS sound");
		}
		const pcm = decodeKaas(stored, layout);
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
