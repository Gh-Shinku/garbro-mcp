// Format reference: GARbro "ArcFormats/Macromedia/AudioSND.cs", class `SndAudio` (Macromedia Director
// audio resource). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { looksLikeMp3 } from "../gameres/mp3-audio.js";
import { type WavFormat, writeWave } from "../shared/wav.js";

/** The format is told apart by the name of its file, which the reference asks for first of all. */
const EXTENSION = ".snd";
/** The first word stands on its own, little endian, before the reader turns big endian. */
const TYPE = 0x0200;
const COUNT_FIELD = 4;
const COMMAND_FIELD = 6;
const COMMAND = 0x8051;
const POSITION_FIELD = 10;
/** The position the header declares must be where the measurements behind it end. */
const HEADER_SIZE = 14;
const PARAM_FIELD = 18;
const SAMPLE_RATE_FIELD = 22;
const ENCODING_FIELD = 34;
const FREQUENCY_FIELD = 35;
/** The frequency byte the reference asks for, `0x3C` = 60. */
const FREQUENCY = 0x3c;
const ENCODING_PCM = 0x00;
const ENCODING_MULTICHANNEL = 0xff;
/** Where a stream of samples begins, either way. */
const SAMPLES_FIELD = 36;
/** The depth and the samples of the other encoding, which stands further in. */
const FRAMES_FIELD = 36;
const DEPTH_FIELD = 62;
const MULTICHANNEL_SAMPLES_FIELD = 78;
const DEPTH_8 = 8;
const DEPTH_16 = 16;

export interface SndLayout {
	channels: number;
	sampleRate: number;
	bitsPerSample: number;
	/** How many samples the stream holds, for the depth that needs the count. */
	framesCount: number;
	/** Where the stream of samples begins. */
	offset: number;
}

function hasExtension(sourcePath: string): boolean {
	const fileName = sourcePath.replace(/^.*[/\\]/, "").toLowerCase();
	return fileName.endsWith(EXTENSION);
}

/**
 * `SndAudio.TryOpen`: the word at the start is `0x0200`, and behind it a header whose fields the reference
 * reads big endian — a count that is not nothing, the command `0x8051`, and a position that must stand where
 * those fields end. Ten bytes on sit the place of the sound, its rate as a word, and eleven bytes more, the
 * encoding; the byte behind it is `0x3C`, and behind that the stream of samples, either directly or behind
 * six words more. An encoding that is neither `0x00` nor `0xFF` is one the reference throws on, which the
 * port reads as a file this format does not claim, and the depth must be eight or sixteen bits.
 */
export function readSndLayout(
	data: Buffer,
	sourcePath?: string,
): SndLayout | undefined {
	if (sourcePath !== undefined && !hasExtension(sourcePath)) return undefined;
	if (data.length < ENCODING_FIELD + 1) return undefined;
	if (data.readUInt16LE(0) !== TYPE) return undefined;
	if (data.length < SAMPLES_FIELD) return undefined;
	if (data.readUInt16BE(COUNT_FIELD) === 0) return undefined;
	if (data.readUInt16BE(COMMAND_FIELD) !== COMMAND) return undefined;
	if (data.readInt32BE(POSITION_FIELD) !== HEADER_SIZE) return undefined;
	const param = data.readInt32BE(PARAM_FIELD);
	const sampleRate = data.readUInt16BE(SAMPLE_RATE_FIELD);
	const encoding = data[ENCODING_FIELD] ?? 0;
	if ((data[FREQUENCY_FIELD] ?? 0) !== FREQUENCY) return undefined;
	let channels = 1;
	let bitsPerSample = DEPTH_8;
	let framesCount = 0;
	let offset = SAMPLES_FIELD;
	if (ENCODING_PCM === encoding) {
		framesCount = param;
	} else if (ENCODING_MULTICHANNEL === encoding) {
		if (data.length < MULTICHANNEL_SAMPLES_FIELD) return undefined;
		channels = param & 0xffff;
		framesCount = data.readInt32BE(FRAMES_FIELD);
		bitsPerSample = data.readUInt16BE(DEPTH_FIELD);
		offset = MULTICHANNEL_SAMPLES_FIELD;
	} else {
		return undefined;
	}
	if (bitsPerSample !== DEPTH_16 && bitsPerSample !== DEPTH_8) return undefined;
	return { channels, sampleRate, bitsPerSample, framesCount, offset };
}

/** The header of the sound the reference hands out, which is built from the fields of the resource. */
function soundFormat(layout: SndLayout): WavFormat {
	return {
		formatTag: 1,
		channels: layout.channels,
		sampleRate: layout.sampleRate,
		// `WaveFormat.SetBPS`, with the block alignment the reference sets beside it.
		averageBytesPerSecond:
			(layout.sampleRate * layout.channels * layout.bitsPerSample) / 8,
		blockAlign: layout.bitsPerSample / 8,
		bitsPerSample: layout.bitsPerSample,
	};
}

/**
 * `SndAudio.TryOpen`: the stream of samples is offered to the MPEG Layer 3 format first, and what the
 * reference hands out when it takes it is a sound of that kind; otherwise the samples stand as they are. A
 * depth of eight bits is taken as it stands, while a depth of sixteen is read **as many bytes as there are
 * samples** — one to a sample rather than two, which is what the reference asks for — and every pair of those
 * is turned around, because the stream keeps them big endian.
 */
function readSound(
	stored: Buffer,
	layout: SndLayout,
): { kind: "mp3" | "wav"; data: Buffer } {
	const region = stored.subarray(layout.offset);
	if (looksLikeMp3(Buffer.from(region))) return { kind: "mp3", data: region };
	if (DEPTH_8 === layout.bitsPerSample) {
		return { kind: "wav", data: Buffer.from(region) };
	}
	const count = Math.max(0, layout.framesCount * layout.channels);
	const samples = Buffer.from(
		region.subarray(0, Math.min(count, region.length)),
	);
	for (let index = 1; index < samples.length; index += 2) {
		const first = samples[index - 1] ?? 0;
		samples[index - 1] = samples[index] ?? 0;
		samples[index] = first;
	}
	return { kind: "wav", data: samples };
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const macromediaSndAudioDescriptor: FormatDescriptor = {
	id: "macromedia-snd-audio",
	name: "Macromedia Director audio resource",
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
			source: "ArcFormats/Macromedia/AudioSND.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const macromediaSndAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: macromediaSndAudioDescriptor,
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return readSndLayout(await readStored(source), sourcePath) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readSndLayout(stored, sourcePath);
		if (!layout) {
			throw invalidSound("Not a Macromedia sound resource");
		}
		const sound = readSound(stored, layout);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "mp3" === sound.kind ? "mp3" : "wav"),
				offset: BigInt(layout.offset),
				size: source.size - BigInt(layout.offset),
				compressed: false,
				metadata: { type: "audio" },
			}),
			// The samples of a sixteen bit stream are shortened to what the reader takes, and a wave container
			// is longer than the stream it holds.
			sizeKnown: false,
		};
		if ("mp3" === sound.kind) {
			return { entries: [entry], metadata: { audio: "mp3" } };
		}
		const format = soundFormat(layout);
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				channels: format.channels,
				sampleRate: format.sampleRate,
				bitsPerSample: format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource, _entry, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readSndLayout(stored, sourcePath);
		if (!layout) {
			throw invalidSound("Not a Macromedia sound resource");
		}
		const sound = readSound(stored, layout);
		if ("mp3" === sound.kind) return Readable.from([sound.data]);
		return Readable.from([writeWave(soundFormat(layout), sound.data)]);
	},
});
