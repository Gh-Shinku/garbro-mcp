// Format reference: GARbro "ArcFormats/Ivory/AudioCTRK.cs", classes `PxAudio` and `TrkDecoder` (a sound of the
// Ivory engine: a head of six and thirty places that names the kind of the places behind it, the places
// standing as places of a sound of the plain kind, as places walked of their own, or as a sound of the Ogg
// kind). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { MsbBitReader } from "@garbro-mcp/codecs";
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

/** The words a sound of this kind stands behind, and the words the head of the sound stands behind where it
 * stands behind words of its own. */
const MARK = Buffer.from("cTRK", "latin1");
const OUTER_MARK = Buffer.from("fPX ", "latin1");
const HEAD_SIZE = 0x24;
const OUTER_SIZE = 8;
/** Where the words of the head stand. */
const LENGTH_FIELD = 0x04;
const HEAD_LENGTH_FIELD = 0x0c;
const SAMPLE_COUNT_FIELD = 0x10;
const RATE_FIELD = 0x14;
const CHANNELS_FIELD = 0x1a;
const BITS_FIELD = 0x1c;
const KIND_FIELD = 0x1e;
const MINIMUM_HEAD_LENGTH = 0x20;
/** The kinds of the places of a sound: the places of a sound of the plain kind, the places of a sound walked
 * of their own, and a sound of the Ogg kind. */
const PLAIN_KIND = 0;
const WALKED_KIND = 2;
const OGG_KIND = 3;
/** Every step of the walk of a sound stands as many places of the sound as this, and a block of the walk stands
 * as this many places of a colour. */
const BLOCK_PLACES = 28;
const PLACE_BITS = 4;
const FIRST_BITS = 8;
const FIRST_SHIFT_BITS = 4;
const FIRST_PLACES = 8;
const LOWEST_PLACE = -0x8000;
const HIGHEST_PLACE = 0x7fff;

export interface PxLayout {
	kind: number;
	headOffset: number;
	headerLength: number;
	dataLength: number;
	rate: number;
	channels: number;
	bitsPerSample: number;
	sampleCount: number;
	dataOffset: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PxAudio.TryOpen`: the words of the head stand behind the words of the sound where it stands behind words of
 * its own, and behind nought of them where it does not; the words beside them name how long the places behind
 * the head stand, how long the head stands, and how many places of a colour the places of the sound stand for,
 * and the words beside those name how many places of a colour stand in a step of the sound, how many of them
 * stand in a place of a colour, and which kind of places stands behind the head.
 */
export function readPxLayout(
	data: Buffer,
	fileLength = data.length,
): PxLayout | undefined {
	if (fileLength < OUTER_SIZE || data.length < OUTER_SIZE) return undefined;
	let headOffset = 0;
	if (data.subarray(0, OUTER_MARK.length).equals(OUTER_MARK)) {
		headOffset = OUTER_SIZE;
	}
	if (
		headOffset + HEAD_SIZE > fileLength ||
		data.length < headOffset + HEAD_SIZE
	) {
		return undefined;
	}
	if (!data.subarray(headOffset, headOffset + MARK.length).equals(MARK)) {
		return undefined;
	}
	const headerLength = data.readInt32LE(headOffset + HEAD_LENGTH_FIELD);
	if (headerLength < MINIMUM_HEAD_LENGTH) return undefined;
	const dataLength = data.readInt32LE(headOffset + LENGTH_FIELD) - headerLength;
	if (dataLength < 0) return undefined;
	const kind = data.readUInt16LE(headOffset + KIND_FIELD);
	const rate = data.readUInt32LE(headOffset + RATE_FIELD);
	const channels = data.readUInt16LE(headOffset + CHANNELS_FIELD);
	const bitsPerSample = data.readUInt16LE(headOffset + BITS_FIELD);
	const sampleCount = data.readInt32LE(headOffset + SAMPLE_COUNT_FIELD);
	const dataOffset = headOffset + headerLength;
	if (dataOffset > fileLength || dataOffset + dataLength > fileLength) {
		return undefined;
	}
	if (PLAIN_KIND === kind || WALKED_KIND === kind) {
		if (channels === 0 || rate === 0) return undefined;
	}
	if (WALKED_KIND === kind && sampleCount < 0) return undefined;
	return {
		kind,
		headOffset,
		headerLength,
		dataLength,
		rate,
		channels,
		bitsPerSample,
		sampleCount,
		dataOffset,
	};
}

/**
 * `TrkDecoder.Decode`: the places of a sound stand as blocks of eight and twenty places of a colour, every
 * block beginning with the places of the first place of a colour of the sound and the places of how far the
 * places of the block stand from it, and every step of the block then naming how far the place it stands for
 * stands from the place before it.
 */
export function decodePx(data: Buffer, layout: PxLayout): Buffer {
	const channels = layout.channels;
	const step = 2 * channels;
	const output: Buffer = Buffer.alloc(layout.sampleCount * step, 0x00);
	const bits = new MsbBitReader(
		data.subarray(layout.dataOffset, layout.dataOffset + layout.dataLength),
	);
	const reference: number[] = new Array(channels).fill(0);
	let blockAt = 0;
	let remaining = layout.sampleCount;
	while (remaining > 0) {
		const blockPlaces = Math.min(remaining, BLOCK_PLACES);
		remaining -= blockPlaces;
		for (let channel = 0; channel < channels; channel += 1) {
			let sample = reference[channel] ?? 0;
			const first = bits.tryReadBits(FIRST_BITS);
			const shift = bits.tryReadBits(FIRST_SHIFT_BITS);
			const firstShift = bits.tryReadBits(FIRST_SHIFT_BITS);
			if (first < 0 || shift < 0 || firstShift < 0) {
				throw invalidSound(
					"Ivory sound is cut short of the places of its walk",
				);
			}
			const difference = first << ((firstShift & 7) + 1);
			if (0 !== (firstShift & FIRST_PLACES)) {
				sample -= difference;
				if (sample < LOWEST_PLACE) sample = LOWEST_PLACE;
			} else {
				sample += difference;
				if (sample > HIGHEST_PLACE) sample = HIGHEST_PLACE;
			}
			let dst = blockAt + 2 * channel;
			for (let place = 0; place < blockPlaces; place += 1) {
				const value = bits.tryReadBits(PLACE_BITS);
				if (-1 === value) {
					throw invalidSound(
						"Ivory sound is cut short of the places of its walk",
					);
				}
				if (0 !== (value & 8)) {
					sample -= (((value & 7) ^ 7) + 1) << shift;
					if (sample < LOWEST_PLACE) sample = LOWEST_PLACE;
				} else {
					sample += (value & 7) << shift;
					if (sample > HIGHEST_PLACE) sample = HIGHEST_PLACE;
				}
				output.writeInt16LE(sample, dst);
				dst += step;
			}
			reference[channel] = sample;
		}
		blockAt += blockPlaces * step;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

function readPx(source: ByteSource, stored: Buffer) {
	const layout = readPxLayout(stored, Number(source.size));
	if (!layout) throw invalidSound("Not an Ivory sound");
	const body = stored.subarray(
		layout.dataOffset,
		layout.dataOffset + layout.dataLength,
	);
	if (PLAIN_KIND === layout.kind) {
		return {
			layout,
			path: "wav",
			body: writeWave(
				{
					formatTag: 1,
					channels: layout.channels,
					sampleRate: layout.rate,
					bitsPerSample: layout.bitsPerSample,
					blockAlign: (layout.bitsPerSample * layout.channels) >> 3,
					averageBytesPerSecond:
						layout.rate *
						(((layout.bitsPerSample * layout.channels) >> 3) >>> 0),
				},
				Buffer.from(body),
			),
		};
	}
	if (WALKED_KIND === layout.kind) {
		return {
			layout,
			path: "wav",
			body: writeWave(
				{
					formatTag: 1,
					channels: layout.channels,
					sampleRate: layout.rate,
					bitsPerSample: 16,
					blockAlign: 2 * layout.channels,
					averageBytesPerSecond: layout.rate * (2 * layout.channels),
				},
				decodePx(stored, layout),
			),
		};
	}
	if (OGG_KIND === layout.kind) {
		return { layout, path: "ogg", body: Buffer.from(body) };
	}
	throw invalidSound(
		"Ivory sound stands as no kind of sound this project reads",
	);
}

export const ivoryPxAudioDescriptor: FormatDescriptor = {
	id: "ivory-px-audio",
	name: "Ivory audio format",
	extensions: ["px", "trk"],
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
			source: "ArcFormats/Ivory/AudioCTRK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ivoryPxAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivoryPxAudioDescriptor,
	detection: {
		signatures: [{ bytes: MARK }, { bytes: Buffer.concat([OUTER_MARK, MARK]) }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(OUTER_SIZE)) return false;
		try {
			const layout = readPxLayout(
				await readStored(source),
				Number(source.size),
			);
			if (!layout) return false;
			return (
				PLAIN_KIND === layout.kind ||
				WALKED_KIND === layout.kind ||
				OGG_KIND === layout.kind
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readPxLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not an Ivory sound");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const extension = OGG_KIND === layout.kind ? "ogg" : "wav";
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(fileName, extension),
					offset: BigInt(layout.dataOffset),
					size: BigInt(layout.dataLength),
					compressed: WALKED_KIND === layout.kind,
					metadata: {
						type: "audio",
						kind: layout.kind,
						channels: layout.channels,
						sampleRate: layout.rate,
					},
				}),
			],
			metadata: {
				audio: OGG_KIND === layout.kind ? "ogg" : "wav",
				kind: layout.kind,
				channels: layout.channels,
				sampleRate: layout.rate,
				sampleCount: layout.sampleCount,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		return Readable.from([readPx(source, stored).body]);
	},
});
