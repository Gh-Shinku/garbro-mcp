// Format reference: GARbro "GameRes/AudioWAV.cs", classes `WaveAudio` and `WaveInput` (a wave of the RIFF
// kind: the places of a sound stand in a chunk of its own behind the chunks that name how the sound stands,
// and the sound of a wave whose places stand as a sound of their own is that sound). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The reference reads a wave through the sound reader of the platform it stands on, which walks the chunks of
// the file, hands out the places of a sound, and turns the places of a sound of the kinds that need turning
// into places of a sound of the plain kind. This port walks the chunks itself and hands out the places of a
// sound as they stand; the kinds that need turning are left as they stand rather than turned.

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
import { looksLikeMp3 } from "./mp3-audio.js";

/** 'RIFF', the word the reference registers, with the word `WAVE` behind it. */
const SIGNATURE = Buffer.from("RIFF", "latin1");
const WAVE_WORD = "WAVE";
const WAVE_WORD_FIELD = 0x08;
/** The places of the sound of a wave stand behind the chunks of the file, the head of a wave standing as
 * `RIFF`, the length of the file, `WAVE`, then a chunk of its own. */
const HEADER_SIZE = 0x16;
/** The chunk that names how the places of a sound stand, which the sound reader of the platform reads the
 * width, the height and the places of a colour out of. */
const FORMAT_CHUNK = "fmt ";
const FORMAT_CHUNK_SIZE = 0x10;
const CHUNK_START = 0x0c;
const CHUNK_HEADER_SIZE = 0x08;
const DATA_CHUNK = "data";
const FORMAT_TAG_FIELD = 0x14;
/** Where the words of how the places of a sound stand stand in the chunk that names them: the word of the
 * codec first, then the width of the sound, how fast it runs, how many of its places stand a second, how many
 * places of a colour stand in a step of the sound, and how many places of a colour stand in a place of it. */
const FORMAT_CHANNELS_FIELD = 0x02;
const FORMAT_SAMPLE_RATE_FIELD = 0x04;
const FORMAT_AVERAGE_BYTES_FIELD = 0x08;
const FORMAT_BLOCK_ALIGN_FIELD = 0x0c;
const FORMAT_BITS_PER_SAMPLE_FIELD = 0x0e;
/** The words of the codecs that stand in the chunk of a wave naming the places of a colour, which the
 * reference turns away from this format and leaves to the kinds that read them. */
const REJECTED_TAGS = [0xffff, 0x676f, 0x6770, 0x674f];
/** The words of the codecs whose places of a sound stand as a sound of their own behind the chunk of the
 * places, which the reference hands to the kinds that read them. */
const EMBEDDED_TAGS = new Set([0x674f, 0x6751, 0x6771, 0x0055]);
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");

export interface WavLayout {
	/** The word of the codec the places of the sound stand as. */
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

export interface WavChunk {
	/** Where the places of the chunk stand and how many of them stand there. */
	offset: number;
	size: number;
}

/**
 * `WaveAudio.TryOpen`: the word `RIFF` stands at the beginning of the file with the word `WAVE` behind it, and
 * the word of the codec the places of the sound stand as stands in the chunk behind those. A wave whose places
 * stand as a sound of their own — the places of a sound of the Ogg kind or of the kind the words `0x676F` and
 * `0x6770` name — is not claimed here.
 */
export function isWavHead(data: Buffer, fileLength = data.length): boolean {
	if (data.length < HEADER_SIZE) return false;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
	if (
		data.toString("latin1", WAVE_WORD_FIELD, WAVE_WORD_FIELD + 4) !== WAVE_WORD
	) {
		return false;
	}
	if (fileLength < HEADER_SIZE) return false;
	const formatTag = data.readUInt16LE(FORMAT_TAG_FIELD);
	return !REJECTED_TAGS.includes(formatTag);
}

/**
 * The width, the height and the places of a colour of a wave stand in the chunk that names how the places of
 * its sound stand, which the sound reader of the platform the reference stands on reads out of that chunk
 * wherever it stands in the file.
 */
export function readWavLayout(
	data: Buffer,
	fileLength = data.length,
): WavLayout | undefined {
	if (!isWavHead(data, fileLength)) return undefined;
	const format = findWavChunk(data, fileLength, FORMAT_CHUNK);
	if (!format || format.size < FORMAT_CHUNK_SIZE) return undefined;
	if (format.offset + FORMAT_CHUNK_SIZE > data.length) return undefined;
	const formatTag = data.readUInt16LE(FORMAT_TAG_FIELD);
	const channels = data.readUInt16LE(format.offset + FORMAT_CHANNELS_FIELD);
	if (0 === channels || 0 === formatTag) return undefined;
	return {
		formatTag,
		channels,
		sampleRate: data.readUInt32LE(format.offset + FORMAT_SAMPLE_RATE_FIELD),
		averageBytesPerSecond: data.readUInt32LE(
			format.offset + FORMAT_AVERAGE_BYTES_FIELD,
		),
		blockAlign: data.readUInt16LE(format.offset + FORMAT_BLOCK_ALIGN_FIELD),
		bitsPerSample: data.readUInt16LE(
			format.offset + FORMAT_BITS_PER_SAMPLE_FIELD,
		),
	};
}

/**
 * The chunk the places of a sound stand in: the chunks of a wave stand one behind the other behind the head,
 * every chunk naming its own length, and the places of a chunk whose length is odd stand a place behind them
 * that the length does not count. The last chunk of a file may name more places than stand in it, which the
 * reference reads up to the end of the file.
 */
export function findWavChunk(
	data: Buffer,
	fileLength: number,
	word: string,
): WavChunk | undefined {
	let at = CHUNK_START;
	while (
		at + CHUNK_HEADER_SIZE <= fileLength &&
		at + CHUNK_HEADER_SIZE <= data.length
	) {
		const standing = data.toString("latin1", at, at + 4);
		const size = data.readUInt32LE(at + 4);
		const body = at + CHUNK_HEADER_SIZE;
		if (word === standing) {
			const places = Math.min(size, Math.max(0, fileLength - body));
			return { offset: body, size: places };
		}
		at = body + size + (size & 1);
	}
	return undefined;
}

/** The chunk the places of a sound stand in, which is named `data`. */
export function findWavDataChunk(
	data: Buffer,
	fileLength = data.length,
): WavChunk | undefined {
	return findWavChunk(data, fileLength, DATA_CHUNK);
}

/**
 * `WaveAudio.TryOpen`: where the word of the codec the places of a wave stand as names a sound that stands as
 * a sound of its own, the reference offers those places to every kind of sound it knows and hands out the one
 * that claims them. This port names the two kinds it knows of its own: a sound of the Ogg kind and one of the
 * kind the places of an MPEG Layer 3 sound stand as.
 */
export function readWavEmbedded(
	data: Buffer,
	layout: WavLayout,
	chunk: WavChunk | undefined,
): "ogg" | "mp3" | undefined {
	if (!chunk) return undefined;
	if (!EMBEDDED_TAGS.has(layout.formatTag)) return undefined;
	const body = data.subarray(chunk.offset, chunk.offset + chunk.size);
	if (body.subarray(0, OGG_SIGNATURE.length).equals(OGG_SIGNATURE))
		return "ogg";
	if (looksLikeMp3(body)) return "mp3";
	return undefined;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

async function readWav(source: ByteSource) {
	const stored = await readStored(source);
	const layout = readWavLayout(stored, Number(source.size));
	if (!layout) throw invalidSound("Not a wave");
	const chunk = findWavDataChunk(stored, Number(source.size));
	const embedded = readWavEmbedded(stored, layout, chunk);
	return { stored, layout, chunk, embedded };
}

export const gameresWavAudioDescriptor: FormatDescriptor = {
	id: "gameres-wav-audio",
	name: "Wave audio format",
	extensions: ["wav"],
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
			source: "GameRes/AudioWAV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gameresWavAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gameresWavAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			// The reference names a wave by its head alone, before the sound reader of the platform walks
			// the chunks of the file.
			return isWavHead(header, Number(source.size));
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const { layout, embedded } = await readWav(source);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, embedded ?? "wav"),
			offset: 0n,
			size: source.size,
			metadata: { type: "audio" },
		});
		return {
			entries: [entry],
			metadata: embedded
				? { audio: embedded }
				: {
						audio: "wav",
						channels: layout.channels,
						sampleRate: layout.sampleRate,
						bitsPerSample: layout.bitsPerSample,
					},
		};
	},
	async openEntry(source: ByteSource) {
		const { stored, chunk, embedded } = await readWav(source);
		if (embedded && chunk) {
			// The places of the sound stand as a sound of their own; the reference hands out that sound.
			return Readable.from([
				Buffer.from(stored.subarray(chunk.offset, chunk.offset + chunk.size)),
			]);
		}
		// The places of the sound are handed out as they stand, in the wave they stand in.
		return Readable.from([stored]);
	},
});
