// Audio Interchange File Format, of the reference `ArcFormats/AudioAIFF.cs` (`AiffAudio`, `AiffInput`).
//
// The reference lays out nothing of this format itself: `AiffAudio.TryOpen` hands the stream over to
// `NAudio.Wave.AiffFileReader` and `AiffInput` reads the places of the format straight out of that reader,
// so the walk of the places of a sound of this file is the walk of the format itself rather than of the
// reference. This port stands of that walk: the chunks of a `FORM` of the kind `AIFF`/`AIFC`, the places
// of a sound of `COMM` and the places of the samples of `SSND`, turned into a wave file of the project.
//
// The reference asks the reader for `SourceBitrate` and `PcmSize` as well, which stand of the places of
// the reader rather than of the file, so this port hands out a wave file of the places of the sound
// instead (`sizeKnown: false`), the way the rest of the audio ports of this project do.

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

/** `'FORM'`, the word the reference registers. */
const SIGNATURE = Buffer.from("FORM", "latin1");
const FORM_TYPE_FIELD = 0x08;
const FORM_TYPES = new Set(["AIFF", "AIFC"]);
const CHUNK_START = 0x0c;
const CHUNK_HEADER_SIZE = 0x08;
const COMM_CHUNK = "COMM";
const COMM_SIZE = 18;
const COMM_CHANNELS_FIELD = 0x00;
const COMM_FRAMES_FIELD = 0x02;
const COMM_BITS_FIELD = 0x06;
const COMM_RATE_FIELD = 0x08;
const COMM_COMPRESSION_FIELD = 0x12;
const SSND_CHUNK = "SSND";
const SSND_SIZE = 0x08;
const SSND_OFFSET_FIELD = 0x00;
/** The kinds of a place of a sound the walk of this port stands of: a sound of the places of the samples
 * as they stand, and a sound of the places of them of the other way of the engine. */
const COMPRESSION_BIG_ENDIAN = new Set(["NONE", "twos"]);
const COMPRESSION_LITTLE_ENDIAN = new Set(["sowt"]);
const SAMPLE_BYTES = new Set([1, 2, 3, 4]);
const HEADER_SIZE = 0x0c;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedSound(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** The places of the walk of a sound of the engine. */
export interface AiffLayout {
	channels: number;
	frames: number;
	bitsPerSample: number;
	sampleRate: number;
	/** The kind of the places of the samples of the file (`NONE`, `sowt`, `twos` and their like). */
	compression: string;
	/** Whether the places of the samples stand of the other way of the engine rather than as they are. */
	littleEndian: boolean;
	dataOffset: number;
	dataSize: number;
}

/**
 * The count of a place of a sample of the format: a place of a sign, a count of a place of the exponent of
 * it, and a mantissa of sixty four places of it, of the place of an integer in front of it. The places of
 * the mantissa of a count of them past the places of a count of this project stand of the count behind
 * them, which is the walk of a sound of the engine rather than of a picture.
 */
export function readAiffExtended(buffer: Buffer, at: number): number {
	if (at + 10 > buffer.length) return 0;
	const exponent = buffer.readUInt16BE(at);
	const mantissa = buffer.readBigUInt64BE(at + 2);
	const places = exponent & 0x7fff;
	if (0 === places && 0n === mantissa) return 0;
	const value = Number(mantissa) / 2 ** 63;
	const count = value * 2 ** (places - 16383);
	return 0 !== (exponent & 0x8000) ? -count : count;
}

/**
 * `AiffFileReader`: the walk of the chunks of a `FORM` of the kind `AIFF` (or of the kind `AIFC`, of the
 * kind of the places of the samples of it named in the places of the sound behind them). The count of the
 * places of the chunks of the file stands past the places of the file rather than within them, the way the
 * reference reads them: a count of a chunk past the places of the file names no chunk of it.
 */
export function readAiffLayout(data: Buffer): AiffLayout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (data.toString("latin1", 0, SIGNATURE.length) !== "FORM") return undefined;
	const form = data.toString("latin1", FORM_TYPE_FIELD, FORM_TYPE_FIELD + 4);
	if (!FORM_TYPES.has(form)) return undefined;
	let channels = 0;
	let frames = 0;
	let bits = 0;
	let sampleRate = 0;
	let compression = "NONE";
	let dataOffset = -1;
	let dataSize = 0;
	let at = CHUNK_START;
	while (at + CHUNK_HEADER_SIZE <= data.length) {
		const id = data.toString("latin1", at, at + 4);
		const size = data.readUInt32BE(at + 4);
		const body = at + CHUNK_HEADER_SIZE;
		if (
			COMM_CHUNK === id &&
			size >= COMM_SIZE &&
			body + COMM_SIZE <= data.length
		) {
			channels = data.readUInt16BE(body + COMM_CHANNELS_FIELD);
			frames = data.readUInt32BE(body + COMM_FRAMES_FIELD);
			bits = data.readUInt16BE(body + COMM_BITS_FIELD);
			sampleRate = readAiffExtended(data, body + COMM_RATE_FIELD);
			if (
				"AIFC" === form &&
				size >= COMM_SIZE + 4 &&
				body + COMM_COMPRESSION_FIELD + 4 <= data.length
			) {
				compression = data.toString(
					"latin1",
					body + COMM_COMPRESSION_FIELD,
					body + COMM_COMPRESSION_FIELD + 4,
				);
			}
		} else if (
			SSND_CHUNK === id &&
			size >= SSND_SIZE &&
			body + SSND_SIZE <= data.length
		) {
			const offset = data.readUInt32BE(body + SSND_OFFSET_FIELD);
			const start = body + SSND_SIZE + offset;
			if (start <= data.length) {
				dataOffset = start;
				dataSize = Math.max(
					0,
					Math.min(size - SSND_SIZE - offset, data.length - start),
				);
			}
		}
		// The chunks of the format stand of a count of an even number of places.
		at = body + size + (size & 1);
	}
	if (0 === channels || 0 === bits || dataOffset < 0) return undefined;
	return {
		channels,
		frames,
		bitsPerSample: bits,
		sampleRate,
		compression,
		littleEndian: COMPRESSION_LITTLE_ENDIAN.has(compression),
		dataOffset,
		dataSize,
	};
}

/** The places of the samples of a wave file, of the places of the file of the walk turned over. */
function turnSamples(pcm: Buffer, sampleBytes: number): Buffer {
	if (1 === sampleBytes) return Buffer.from(pcm);
	const out = Buffer.alloc(pcm.length, 0x00);
	for (let at = 0; at + sampleBytes <= pcm.length; at += sampleBytes) {
		for (let place = 0; place < sampleBytes; place += 1) {
			out[at + place] = pcm[at + sampleBytes - 1 - place] ?? 0;
		}
	}
	return out;
}

/** The walk of a sound of the file, of the places of the samples of it of a wave file. */
export function readAiffSound(data: Buffer): Buffer {
	const layout = readAiffLayout(data);
	if (!layout) throw invalidSound("Not an AIFF sound");
	if (
		!COMPRESSION_BIG_ENDIAN.has(layout.compression) &&
		!COMPRESSION_LITTLE_ENDIAN.has(layout.compression)
	) {
		throw unsupportedSound(
			`AIFF sound of the kind ${layout.compression} stands of a walk of its own`,
		);
	}
	const sampleBytes = layout.bitsPerSample >> 3;
	if (0 !== (layout.bitsPerSample & 7) || !SAMPLE_BYTES.has(sampleBytes)) {
		throw unsupportedSound(
			`AIFF sound of ${layout.bitsPerSample} places of a sample stands unported`,
		);
	}
	const stored = data.subarray(
		layout.dataOffset,
		layout.dataOffset + layout.dataSize,
	);
	const pcm = layout.littleEndian ? stored : turnSamples(stored, sampleBytes);
	const blockAlign = layout.channels * sampleBytes;
	return writeWave(
		{
			formatTag: 1,
			channels: layout.channels,
			sampleRate: Math.round(layout.sampleRate),
			averageBytesPerSecond: Math.round(layout.sampleRate) * blockAlign,
			blockAlign,
			bitsPerSample: layout.bitsPerSample,
		},
		pcm,
	);
}

export const aiffAudioDescriptor: FormatDescriptor = {
	id: "gameres-aiff-audio",
	name: "Audio Interchange File Format",
	extensions: ["aif", "aiff"],
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
			source: "ArcFormats/AudioAIFF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aiffAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aiffAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			if (head.toString("latin1", 0, SIGNATURE.length) !== "FORM") {
				return false;
			}
			return FORM_TYPES.has(
				head.toString("latin1", FORM_TYPE_FIELD, FORM_TYPE_FIELD + 4),
			);
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readAiffLayout(data);
		if (!layout) throw invalidSound("Not an AIFF sound");
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
					sampleRate: Math.round(layout.sampleRate),
					channels: layout.channels,
					samples: layout.frames,
					bitsPerSample: layout.bitsPerSample,
				},
			}),
			// The places of the samples are turned over where the file stands of the other way of the
			// engine, and a wave header is written around them.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression: "pcm",
				sampleRate: Math.round(layout.sampleRate),
				channels: layout.channels,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		return Readable.from([readAiffSound(data)]);
	},
});
