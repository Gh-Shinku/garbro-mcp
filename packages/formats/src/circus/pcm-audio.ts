// Format reference: GARbro "ArcFormats/Circus/AudioPCM.cs", classes `PcmAudio`, `PcmDecoder` and the
// `XpcmCompression` they select between. GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT
// License.

import { Readable } from "node:stream";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { inflateZlibBufferCapped } from "@garbro-mcp/codecs";
import { changeExtension } from "../shared/companion.js";
import {
	decodePcmStream,
	unpackPcmLzss,
	walkedStreamSize,
} from "./pcm-decoder.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";

/** `PcmAudio.Signature`: `XPCM`. */
const MARK = Buffer.from("XPCM", "latin1");
const MARK_SIZE = MARK.length;
const SIZE_AT = 4;
/** The mode word holds the kind of compression in its low byte and `extra` above it. */
const MODE_AT = 8;
const MODE_MASK = 0xff;
const EXTRA_SHIFT = 8;
const EXTRA_MASK = 0xff;
/** The fifth mode hands an Ogg stream over: its size and then the stream itself. */
const OGG_MODE = 5;
const OGG_SIZE_AT = 0x0c;
const OGG_AT = 0x10;
/** The other modes carry a wave format and the samples behind it. */
const FORMAT_AT = 0x0c;
const FORMAT_SIZE = 0x10;
const HEAD_SIZE = FORMAT_AT + FORMAT_SIZE;
/** The two packed modes carry the count of the packed places and then the packed stream itself. */
const PACKED_SIZE_AT = HEAD_SIZE;
const PACKED_AT = PACKED_SIZE_AT + 4;
const PLAIN_MODE = 0;
const LZSS_MODE = 1;
const ZLIB_MODE = 3;
const EXTRA_MAX = 3;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `PcmDecoder` + `PcmAudio.TryOpen` of the two packed modes: the count of the packed places stands at
 * 0x1C, the packed stream itself at 0x20, and the walk of it turns `sourceSize` places of samples out.
 * The first packed mode reads its own container, the third one a zlib stream; both then hand the walked
 * stream to `DecodeV1` and the samples to the wave format of the head.
 */
async function decodePackedPcm(
	data: Buffer,
	layout: PcmLayout,
	format: NonNullable<PcmLayout["format"]>,
): Promise<Buffer> {
	if (data.length < PACKED_AT) {
		throw invalidSound(
			"A packed sound of the engine with no stream behind its head",
		);
	}
	const packedSize = data.readInt32LE(PACKED_SIZE_AT);
	if (packedSize < 0) {
		throw invalidSound("A packed sound of the engine of no packed places");
	}
	const encoded = Buffer.alloc(walkedStreamSize(layout.sourceSize), 0);
	if (LZSS_MODE === layout.mode) {
		if (PACKED_AT + packedSize > data.length) {
			throw invalidSound("A packed sound of the engine the file cuts short");
		}
		unpackPcmLzss(
			data.subarray(PACKED_AT, PACKED_AT + packedSize),
			packedSize,
			encoded,
		);
	} else {
		const walked = await inflateZlibBufferCapped(
			data.subarray(PACKED_AT),
			encoded.length,
		);
		encoded.set(walked.subarray(0, encoded.length));
	}
	const samples = decodePcmStream(encoded, layout.sourceSize, layout.extra);
	return writeWave(format, samples);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	if (!Number.isSafeInteger(size) || size < 0) {
		throw invalidSound("A sound of the engine of no places of the file");
	}
	const data = await source.readAt(0n, size);
	return Buffer.isBuffer(data) ? data : Buffer.from(data as Uint8Array);
}

/** The head of a sound of the engine. */
export interface PcmLayout {
	mode: number;
	extra: number;
	/** The count of the places of the sound as the head declares them. */
	sourceSize: number;
	/** The fifth mode hands an Ogg stream over rather than a wave. */
	ogg: boolean;
	format?: {
		formatTag: number;
		channels: number;
		sampleRate: number;
		averageBytesPerSecond: number;
		blockAlign: number;
		bitsPerSample: number;
	};
}

/**
 * `PcmAudio.TryOpen`: the mark, the count of the places, the mode and then either the size of the Ogg
 * stream of the fifth mode or the wave format of the others.
 */
export function readPcmLayout(data: Buffer): PcmLayout | undefined {
	if (data.length < OGG_AT || !data.subarray(0, MARK_SIZE).equals(MARK)) {
		return undefined;
	}
	const sourceSize = data.readInt32LE(SIZE_AT);
	if (sourceSize <= 0) return undefined;
	const mode = data.readInt32LE(MODE_AT);
	const extra = (mode >> EXTRA_SHIFT) & EXTRA_MASK;
	const kind = mode & MODE_MASK;
	if (OGG_MODE === kind) {
		return { mode: kind, extra, sourceSize, ogg: true };
	}
	if (kind !== PLAIN_MODE && kind !== LZSS_MODE && kind !== ZLIB_MODE) {
		return undefined;
	}
	// Only the decoder of the two packed modes reads `extra`: the reference checks it there alone.
	if (
		(kind === LZSS_MODE || kind === ZLIB_MODE) &&
		(extra < 0 || extra > EXTRA_MAX)
	) {
		return undefined;
	}
	if (data.length < HEAD_SIZE) return undefined;
	return {
		mode: kind,
		extra,
		sourceSize,
		ogg: false,
		format: {
			formatTag: data.readUInt16LE(FORMAT_AT),
			channels: data.readUInt16LE(FORMAT_AT + 2),
			sampleRate: data.readUInt32LE(FORMAT_AT + 4),
			averageBytesPerSecond: data.readUInt32LE(FORMAT_AT + 8),
			blockAlign: data.readUInt16LE(FORMAT_AT + 12),
			bitsPerSample: data.readUInt16LE(FORMAT_AT + 14),
		},
	};
}

export const circusPcmAudioDescriptor: FormatDescriptor = {
	id: "circus-pcm-audio",
	name: "Circus PCM audio",
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
			source: "ArcFormats/Circus/AudioPCM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const circusPcmAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: circusPcmAudioDescriptor,
	detection: { signatures: [{ bytes: MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(OGG_AT)) return false;
		try {
			// A sound of the two packed modes is one of the sounds of the engine as well: the reference
			// knows its decoder, and this port refuses it only once the places are asked for.
			return undefined !== readPcmLayout(await readStored(source));
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const data = await readStored(source);
		const layout = readPcmLayout(data);
		if (!layout) {
			throw invalidSound("Not a sound of the engine");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		if (layout.ogg) {
			const size = data.readUInt32LE(OGG_SIZE_AT);
			const start = OGG_AT;
			const end = Math.min(data.length, start + size);
			return {
				entries: [
					{
						...createFixedEntry({
							id: 0,
							path: changeExtension(fileName, "ogg"),
							offset: BigInt(start),
							size: BigInt(Math.max(0, end - start)),
							metadata: { type: "audio", mode: layout.mode },
						}),
						sizeKnown: false,
					},
				],
				metadata: { audio: "ogg", mode: layout.mode },
			};
		}
		const format = layout.format;
		if (!format) throw invalidSound("Not a sound of the engine");
		const packed = LZSS_MODE === layout.mode || ZLIB_MODE === layout.mode;
		const start = packed ? PACKED_AT : HEAD_SIZE;
		const end = Math.min(data.length, start + layout.sourceSize);
		return {
			entries: [
				{
					...createFixedEntry({
						id: 0,
						path: changeExtension(fileName, "wav"),
						offset: BigInt(start),
						size: BigInt(Math.max(0, end - start)),
						metadata: {
							type: "audio",
							mode: layout.mode,
							packed,
							sampleRate: format.sampleRate,
							channels: format.channels,
							bitsPerSample: format.bitsPerSample,
						},
					}),
					sizeKnown: false,
				},
			],
			metadata: {
				audio: "wav",
				mode: layout.mode,
				sampleRate: format.sampleRate,
				channels: format.channels,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = await readStored(source);
		const layout = readPcmLayout(data);
		if (!layout) throw invalidSound("Not a sound of the engine");
		if (LZSS_MODE === layout.mode || ZLIB_MODE === layout.mode) {
			const format = layout.format;
			if (!format) throw invalidSound("Not a sound of the engine");
			const pcm = await decodePackedPcm(data, layout, format);
			return Readable.from([pcm]);
		}
		if (layout.ogg) {
			const size = data.readUInt32LE(OGG_SIZE_AT);
			const start = OGG_AT;
			return Readable.from([
				data.subarray(start, Math.min(data.length, start + size)),
			]);
		}
		const format = layout.format;
		if (!format) throw invalidSound("Not a sound of the engine");
		void entry;
		const start = HEAD_SIZE;
		const end = Math.min(data.length, start + layout.sourceSize);
		return Readable.from([writeWave(format, data.subarray(start, end))]);
	},
});
