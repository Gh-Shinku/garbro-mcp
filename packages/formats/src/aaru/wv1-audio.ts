// Format reference: GARbro "Legacy/Aaru/AudioWV1.cs", classes `Wv1Audio` and `Wv1Decoder` (the engine's own
// four bit ADPCM behind a `WV1.0` head). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

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

/** 'WV1.' as the word the reference registers; the head itself spells `WV1.0` and a nought. */
const SIGNATURE = Buffer.from("WV1.", "latin1");
const MARK = "WV1.0\0";
const HEADER_SIZE = 0x30;
const CHANNELS_FIELD = 0x0a;
const SAMPLE_RATE_FIELD = 0x0e;
const SAMPLE_COUNT_FIELD = 0x26;
const BITS_PER_SAMPLE = 16;
/** A sound this project is willing to hold, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;
const MAXIMUM_INDEX = 0x7f;

/**
 * `Wv1Decoder.SampleTable`, the step of the walk for every place the index may stand at.
 */
const SAMPLE_TABLE = new Int16Array([
	0x0007, 0x0008, 0x0009, 0x000a, 0x000b, 0x000c, 0x000e, 0x000f, 0x0010,
	0x0012, 0x0014, 0x0015, 0x0017, 0x0019, 0x001b, 0x001d, 0x0020, 0x0022,
	0x0025, 0x0028, 0x002b, 0x002e, 0x0031, 0x0035, 0x0038, 0x003c, 0x0041,
	0x0045, 0x004a, 0x004f, 0x0055, 0x005a, 0x0061, 0x0067, 0x006e, 0x0075,
	0x007d, 0x0085, 0x008e, 0x0098, 0x00a2, 0x00ac, 0x00b7, 0x00c3, 0x00d0,
	0x00de, 0x00ec, 0x00fb, 0x010b, 0x011c, 0x012f, 0x0142, 0x0157, 0x016d,
	0x0184, 0x019c, 0x01b7, 0x01d3, 0x01f0, 0x0210, 0x0231, 0x0254, 0x027a,
	0x02a2, 0x02cd, 0x02fa, 0x032a, 0x035d, 0x0393, 0x03cd, 0x040a, 0x044b,
	0x0490, 0x04d9, 0x0527, 0x057a, 0x05d2, 0x062f, 0x0693, 0x06fc, 0x076c,
	0x07e3, 0x0862, 0x08e8, 0x0977, 0x0a0e, 0x0aaf, 0x0b5a, 0x0c10, 0x0cd1,
	0x0d9e, 0x0e78, 0x0f60, 0x1056, 0x115b, 0x1270, 0x1397, 0x14d1, 0x161d,
	0x177f, 0x18f7, 0x1a86, 0x1c2e, 0x1df0, 0x1fcf, 0x21cb, 0x23e7, 0x2625,
	0x2886, 0x2b0e, 0x2dbe, 0x3098, 0x33a1, 0x36d9, 0x3a46, 0x3de9, 0x41c5,
	0x45e0, 0x4a3c, 0x4ede, 0x53ca, 0x5904, 0x5e92, 0x6478, 0x6abc, 0x7165,
	0x7878, 0x7fff,
]);

export interface Wv1Layout {
	channels: number;
	sampleRate: number;
	/** The count of samples of every channel taken together. */
	sampleCount: number;
	/** The bytes of the stream the walk reads, which is the count rounded up to two. */
	dataLength: number;
	/** How much of the stream the file actually holds. */
	fileLength: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** A signed word, which is what the reference's own `short` fields do to every value written to them. */
function toInt16(value: number): number {
	return (value << 16) >> 16;
}

/**
 * `Wv1Audio.TryOpen`: the head begins with `WV1.0` and a nought, the channel count stands at `0xA` as a
 * word, the sample rate at `0xE` as a word, the depth is always sixteen bits, and the count of samples — of
 * every channel taken together — stands at `0x26`. The samples follow the head, two to every byte.
 */
export function readWv1Layout(
	data: Buffer,
	fileLength = data.length,
): Wv1Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.subarray(0, MARK.length).toString("latin1") !== MARK)
		return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels !== 1 && channels !== 2) return undefined;
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	const sampleCount = data.readInt32LE(SAMPLE_COUNT_FIELD);
	if (sampleCount <= 0 || 2 * sampleCount > LIMIT) return undefined;
	// The reference does not ask for the whole stream: its walk ends quietly where the file does. The
	// declared length is kept as it stands, and only the head is behind it.
	return {
		channels,
		sampleRate,
		sampleCount,
		dataLength: Math.ceil(sampleCount / 2),
		fileLength,
	};
}

/**
 * `Wv1Decoder`: the step of the walk stands in the sample table at the place of its own index, and seven
 * more steps are built from it — three halves, quarters and eighths of it, and the index itself with each
 * of them added. A code's low three bits choose one of the eight, and its fourth bit says which way the
 * step goes; the index then moves by the code: down one for the four smallest, and up by two, four, six or
 * eight for the rest. The sample handed out is the walk's own value doubled, and every step of the
 * arithmetic is a signed word.
 */
export class Wv1Decoder {
	#lastSample = 0;
	#lastIndex = 0;

	decode(input: number): number {
		const step = SAMPLE_TABLE[this.#lastIndex] ?? 0;
		const shifts = new Int32Array(8);
		shifts[0] = step >> 3;
		shifts[1] = (shifts[0] ?? 0) + (step >> 2);
		shifts[2] = (shifts[0] ?? 0) + (step >> 1);
		shifts[3] = (shifts[1] ?? 0) + (step >> 1);
		shifts[4] = (shifts[0] ?? 0) + step;
		shifts[5] = (shifts[1] ?? 0) + step;
		shifts[6] = (shifts[2] ?? 0) + step;
		shifts[7] = (shifts[3] ?? 0) + step;
		const index = input & 7;
		const delta = toInt16(shifts[index] ?? 0);
		if (0 !== (input & 8)) {
			this.#lastSample = toInt16(this.#lastSample - delta);
		} else {
			this.#lastSample = toInt16(this.#lastSample + delta);
		}
		switch (index) {
			case 0:
			case 1:
			case 2:
			case 3:
				if (this.#lastIndex > 0) this.#lastIndex -= 1;
				break;
			case 4:
				this.#lastIndex = Math.min(this.#lastIndex + 2, MAXIMUM_INDEX);
				break;
			case 5:
				this.#lastIndex = Math.min(this.#lastIndex + 4, MAXIMUM_INDEX);
				break;
			case 6:
				this.#lastIndex = Math.min(this.#lastIndex + 6, MAXIMUM_INDEX);
				break;
			default:
				this.#lastIndex = Math.min(this.#lastIndex + 8, MAXIMUM_INDEX);
				break;
		}
		return toInt16(2 * this.#lastSample);
	}
}

/**
 * `Wv1Audio.TryOpen`'s walk: a byte's **low** nibble is the sample of an even place and its high nibble the
 * sample of the odd place behind it. A sound of one channel decodes both with the same walk, so its own
 * state carries from one to the next; a sound of two channels gives every other sample to a walk of its
 * own. A stream that ends before the count is reached ends the sound quietly, as the reference returns
 * there.
 */
export function decodeWv1(stored: Buffer, layout: Wv1Layout): Buffer {
	const first = new Wv1Decoder();
	const second = 1 === layout.channels ? first : new Wv1Decoder();
	const output: Buffer = Buffer.alloc(2 * layout.sampleCount, 0x00);
	let input = 0;
	let position = HEADER_SIZE;
	for (let index = 0; index < layout.sampleCount; index += 1) {
		let sample: number;
		if (0 !== (index & 1)) {
			sample = second.decode(input >> 4);
		} else {
			if (position >= stored.length) break;
			input = stored[position] ?? 0;
			position += 1;
			sample = first.decode(input & 0x0f);
		}
		output.writeInt16LE(sample, 2 * index);
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const aaruWv1AudioDescriptor: FormatDescriptor = {
	id: "aaru-wv1-audio",
	name: "Aaru compressed audio",
	extensions: ["wv1", "wav"],
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
			source: "Legacy/Aaru/AudioWV1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aaruWv1AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aaruWv1AudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (header.subarray(0, MARK.length).toString("latin1") !== MARK) {
				return false;
			}
			const channels = header.readUInt16LE(CHANNELS_FIELD);
			if (channels !== 1 && channels !== 2) return false;
			const sampleCount = header.readInt32LE(SAMPLE_COUNT_FIELD);
			return sampleCount > 0 && 2 * sampleCount <= LIMIT;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readWv1Layout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidSound("Not an Aaru sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(
					Math.max(
						0,
						Math.min(layout.dataLength, layout.fileLength - HEADER_SIZE),
					),
				),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					samples: layout.sampleCount,
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
		const layout = readWv1Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not an Aaru sound");
		}
		const pcm = decodeWv1(stored, layout);
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
