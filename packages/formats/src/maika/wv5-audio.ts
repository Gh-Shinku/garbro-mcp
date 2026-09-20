// Format reference: GARbro "ArcFormats/Maika/AudioWV5.cs", classes `Wv5Audio` and `Wv5Decoder` (a Maika sound:
// the places of the sound stand as the places of a walk of runs, every step of the walk naming how many places
// stand the same way and standing the places of a colour of its own beside the place before it). GARbro commit
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
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";

/** 'WV5A', the word the reference registers. */
const SIGNATURE = Buffer.from("WV5A", "latin1");
/** The head of a sound of this kind: how many places of the sound stand beside each other, how fast it runs,
 * how many places of it stand, and how many steps the walk of its places stands in. */
const CHANNELS_FIELD = 0x04;
const SAMPLE_RATE_FIELD = 0x06;
const SAMPLE_COUNT_FIELD = 0x0a;
const CHUNK_COUNT_FIELD = 0x0e;
/** The walk of the places of the sound begins behind those words. */
const WALK_OFFSET = 0x12;
/** The places of a colour of a sound of this kind stand in two places each, and its runs name whole places of
 * a colour, so that a step of the walk that names no places stands two hundred and fifty six of them. */
const BITS_PER_SAMPLE = 16;
const BYTES_PER_SAMPLE = 2;
const FULL_RUN = 256;
/** The walk of runs: a step that names no run of its own, one that names a run of two places, and one that
 * names the run of places behind it. A step that names a whole run stands as the step that names no run of its
 * own, its places standing one at a time.
 */
const RUN_NONE = 0;
const RUN_SMALL = 2;
const RUN_LONG = 3;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/** How many places of a colour a place of the sound stands beside the place before it: the table of the
 * reference, whose places behind the first hundred and twenty eight stand as the places before them stood, the
 * other way round. */
function buildWv5Table(): Int16Array {
	const table = new Int16Array(0x100);
	const first = [
		0x0000, 0x0001, 0x0002, 0x0003, 0x0004, 0x0005, 0x0007, 0x0008, 0x0009,
		0x000b, 0x000d, 0x000e, 0x0010, 0x0012, 0x0014, 0x0016, 0x0019, 0x001b,
		0x001e, 0x0021, 0x0024, 0x0027, 0x002a, 0x002e, 0x0031, 0x0035, 0x003a,
		0x003e, 0x0043, 0x0048, 0x004e, 0x0053, 0x005a, 0x0060, 0x0067, 0x006e,
		0x0076, 0x007f, 0x0087, 0x0091, 0x009b, 0x00a5, 0x00b1, 0x00bc, 0x00c9,
		0x00d7, 0x00e5, 0x00f4, 0x0104, 0x0116, 0x0128, 0x013b, 0x0150, 0x0166,
		0x017d, 0x0196, 0x01b0, 0x01cc, 0x01e9, 0x0209, 0x022a, 0x024e, 0x0273,
		0x029b, 0x02c6, 0x02f3, 0x0323, 0x0356, 0x038c, 0x03c6, 0x0403, 0x0444,
		0x0489, 0x04d3, 0x0521, 0x0573, 0x05cb, 0x0629, 0x068c, 0x06f6, 0x0766,
		0x07dd, 0x085b, 0x08e1, 0x0970, 0x0a08, 0x0aa9, 0x0b54, 0x0c0a, 0x0ccb,
		0x0d98, 0x0e72, 0x0f5a, 0x1050, 0x1155, 0x126b, 0x1392, 0x14cb, 0x1618,
		0x177a, 0x18f2, 0x1a81, 0x1c29, 0x1deb, 0x1fca, 0x21c7, 0x23e3, 0x2621,
		0x2882, 0x2b0a, 0x2dba, 0x3095, 0x339e, 0x36d7, 0x3a43, 0x3de6, 0x41c4,
		0x45de, 0x4a3b, 0x4edd, 0x53c9, 0x5904, 0x5e92, 0x6479, 0x6abe, 0x7167,
		0x787a, 0x7fff,
	];
	for (let at = 0; at < 0x80; at += 1) {
		const value = first[at] ?? 0;
		table[at] = value;
		table[0x80 + at] = -value;
	}
	return table;
}

const PCM_TABLE = buildWv5Table();

export interface Wv5Layout {
	channels: number;
	sampleRate: number;
	sampleCount: number;
	chunkCount: number;
}

/**
 * `Wv5Decoder`: the head of a sound of this kind names how many places of the sound stand beside each other,
 * how fast it runs, how many places of it stand and how many steps the walk of its places stands in. The
 * reference stands its places in two places of a colour each.
 */
export function readWv5Layout(
	data: Buffer,
	fileLength = data.length,
): Wv5Layout | undefined {
	if (data.length < WALK_OFFSET) return undefined;
	if (fileLength < WALK_OFFSET) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels <= 0 || 0 !== (channels & (channels - 1))) return undefined;
	const sampleCount = data.readInt32LE(SAMPLE_COUNT_FIELD);
	const chunkCount = data.readInt32LE(CHUNK_COUNT_FIELD);
	if (sampleCount <= 0 || chunkCount <= 0) return undefined;
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	if (0 === sampleRate) return undefined;
	return { channels, sampleRate, sampleCount, chunkCount };
}

/**
 * `Wv5Decoder.Unpack`: every step of the walk of runs names how many places of the sound stand the same way,
 * and stands one place of a colour beside the places beside it. A step that names no places of its own stands
 * one place at a time, a step that names a whole run stands two hundred and fifty six of them, a step that
 * names a run of two places stands as many as it names, and a step that names the run of places behind it
 * stands those places in two places of a colour each. Every place of the sound stands beside the place before
 * it of the places of the sound that stand beside each other, the places of a colour standing one after the
 * other.
 */
export function decodeWv5(data: Buffer, layout: Wv5Layout): Buffer {
	const channels = layout.channels;
	const mask = channels - 1;
	const samples = new Int16Array(channels);
	const output: Buffer = Buffer.alloc(
		layout.sampleCount * channels * BYTES_PER_SAMPLE,
		0x00,
	);
	let at = WALK_OFFSET;
	let channel = 0;
	let dst = 0;
	for (let chunk = 0; chunk < layout.chunkCount; chunk += 1) {
		if (at >= data.length) {
			throw invalidSound("WV5 sound is cut short of its own walk");
		}
		const control = data[at] ?? 0;
		at += 1;
		let count: number;
		let places: number[];
		if (control < RUN_SMALL) {
			count = RUN_NONE === control ? (data[at++] ?? 0) : FULL_RUN;
			places = [];
			for (let place = 0; place < count; place += 1) {
				if (at >= data.length) {
					throw invalidSound("WV5 sound is cut short of its own walk");
				}
				places.push(data[at] ?? 0);
				at += 1;
			}
		} else {
			if (RUN_LONG === control) {
				if (at + 2 > data.length) {
					throw invalidSound("WV5 sound is cut short of its own walk");
				}
				count = data.readUInt16LE(at);
				at += 2;
			} else {
				count = control;
			}
			if (at >= data.length) {
				throw invalidSound("WV5 sound is cut short of its own walk");
			}
			const place = data[at] ?? 0;
			at += 1;
			places = new Array<number>(count).fill(place);
		}
		for (const place of places) {
			const channelAt = channel++ & mask;
			const value = ((samples[channelAt] ?? 0) + (PCM_TABLE[place] ?? 0)) | 0;
			samples[channelAt] = (value << 16) >> 16;
			if (dst + BYTES_PER_SAMPLE > output.length) {
				throw invalidSound("WV5 sound names more places than it holds");
			}
			output.writeInt16LE(samples[channelAt] ?? 0, dst);
			dst += BYTES_PER_SAMPLE;
		}
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readWv5(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readWv5Layout(stored, Number(source.size));
	if (!layout) throw invalidSound("Not a WV5 sound");
	return { stored, layout };
}

export const maikaWv5AudioDescriptor: FormatDescriptor = {
	id: "maika-wv5-audio",
	name: "Maika sound format",
	extensions: ["wv5"],
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
			source: "ArcFormats/Maika/AudioWV5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const maikaWv5AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: maikaWv5AudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(WALK_OFFSET)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, WALK_OFFSET));
			return readWv5Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const { layout } = await readWv5(source);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "wav"),
			offset: BigInt(WALK_OFFSET),
			size: source.size - BigInt(WALK_OFFSET),
			compressed: true,
			metadata: { type: "audio" } as Record<string, unknown>,
		});
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				channels: layout.channels,
				sampleRate: layout.sampleRate,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const { stored, layout } = await readWv5(source);
		// The places of the sound stand as a wave of the plain kind.
		return Readable.from([
			writeWave(
				{
					formatTag: 1,
					channels: layout.channels,
					sampleRate: layout.sampleRate,
					averageBytesPerSecond:
						layout.channels * BYTES_PER_SAMPLE * layout.sampleRate,
					blockAlign: layout.channels * BYTES_PER_SAMPLE,
					bitsPerSample: BITS_PER_SAMPLE,
				},
				decodeWv5(stored, layout),
			),
		]);
	},
});
