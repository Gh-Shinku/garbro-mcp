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
const HEADER_SIZE = 0x16;
const FORMAT_CHUNK = "fmt ";
const FORMAT_CHUNK_SIZE = 0x10;
const CHUNK_START = 0x0c;
const CHUNK_HEADER_SIZE = 0x08;
const DATA_CHUNK = "data";
const FORMAT_TAG_FIELD = 0x14;
const FORMAT_CHANNELS_FIELD = 0x02;
const FORMAT_SAMPLE_RATE_FIELD = 0x04;
const FORMAT_AVERAGE_BYTES_FIELD = 0x08;
const FORMAT_BLOCK_ALIGN_FIELD = 0x0c;
const FORMAT_BITS_PER_SAMPLE_FIELD = 0x0e;
const REJECTED_TAGS = [0xffff, 0x676f, 0x6770, 0x674f];
/** The words of the codecs whose places of a sound stand as a sound of their own behind the chunk of the
 * places, which the reference hands to the kinds that read them. */
const EMBEDDED_TAGS = new Set([0x674f, 0x6751, 0x6771, 0x0055]);
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");

export interface WavLayout {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

export interface WavChunk {
	offset: number;
	size: number;
}

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

export function findWavDataChunk(
	data: Buffer,
	fileLength = data.length,
): WavChunk | undefined {
	return findWavChunk(data, fileLength, DATA_CHUNK);
}

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
			return Readable.from([
				Buffer.from(stored.subarray(chunk.offset, chunk.offset + chunk.size)),
			]);
		}
		return Readable.from([stored]);
	},
});
