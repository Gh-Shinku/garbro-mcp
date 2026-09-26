// The sound of the Entis engine (`MIO`), of the reference `ArcFormats/Entis/AudioMIO.cs` (`MioAudio`,
// `MioInput`) over the walks of `ArcFormats/Entis/MioDecoder.cs` (`MioDecoder`, `MioInfoHeader`,
// `MioDataHeader`).
//
// A sound of the engine stands of the head of the archives of it (`Enti`, the identifier of the kind of the
// file and the name of it) and of the sections of the head of it: the `SoundInf` section (the counts of the
// sound and the kind of the places of the walk of it) and then a chain of `SoundStm` sections, every one of
// them a count of the places of the walk of the sound. A sound of the kind `Lossless_ERI` stands of the
// counts of a picture of the engine alone, of a count of no sign at all and of a count of the counts behind
// it, which the walk of the engine stands of (`codecs/erisa-context.ts`); a sound of the kinds `LOT_ERI`
// and `LOT_ERI_MSS` stands of the walks of a picture of the engine itself (the walks of the counts of a
// picture, of the places of a colour and of the places of a block of it), which stand unported here.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { ErisaHuffmanDecodeContext } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";

const SIGNATURE = Buffer.from("Enti", "latin1");
const HEADER_SIZE = 0x40;
const SECTION_HEADER_SIZE = 0x10;
const ID_OFFSET = 8;
const SUPPORTED_ID = 0x03000100;
const MUSIC_NAME = "Music Interleaved";
const HEADER_SECTION = "Header  ";
const SOUND_INFO_SECTION = "SoundInf";
const STREAM_SECTION = "Stream  ";
const SOUND_STREAM_SECTION = "SoundStm";
const CHUNK_HEADER_SIZE = 0x08;
const BODY_LIMIT = 0x1000000;
const CHUNK_LIMIT = 0x100000;
/** The kinds of the walk of the places of a sound of the engine (`CvType`). */
const TRANSFORMATION_LOSSLESS_ERI = 0x03020000;
const TRANSFORMATION_LOT_ERI = 0x00000005;
const TRANSFORMATION_LOT_ERI_MSS = 0x00000105;
/** The kinds of the counts of the walk of a sound of the engine (`EriCode`). */
const ARCHITECTURE_RUN_LENGTH_HUFFMAN = -4;
const ARCHITECTURE_NEMESIS = -16;
const BITS_PER_SAMPLE_8 = 8;
const BITS_PER_SAMPLE_16 = 16;
const CHANNEL_LIMIT = 2;
/** The flag of the count of the walk of a sound of the engine: the walk of the counts of it begins. */
const MIO_LEAD_BLOCK = 0x01;

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedSound(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/** `MioInfoHeader`: the counts of a sound of the engine and the kind of the walk of the places of it. */
export interface MioInfoHeader {
	version: number;
	transformation: number;
	architecture: number;
	channelCount: number;
	samplesPerSec: number;
	blocksetCount: number;
	subbandDegree: number;
	allSampleCount: number;
	lappedDegree: number;
	bitsPerSample: number;
}

/** A count of the places of the walk of a sound of the engine (`SoundStm`). */
export interface MioChunk {
	/** The places of the count of the walk of the engine within the file. */
	offset: number;
	/** The count of the places of the count of the walk of the engine. */
	size: number;
	version: number;
	flags: number;
	sampleCount: number;
}

export interface MioLayout {
	info: MioInfoHeader;
	chunks: MioChunk[];
}

/** `EriFile.ReadSection`: the name of a section of the engine and the count of the places behind it. */
function readSectionHead(
	data: Buffer,
	at: number,
): { id: string; length: number } | undefined {
	if (at + SECTION_HEADER_SIZE > data.length) return undefined;
	const id = data.toString("latin1", at, at + 8);
	const length = data.readBigInt64LE(at + 8);
	if (length < 0n || length > BigInt(Number.MAX_SAFE_INTEGER)) return undefined;
	return { id, length: Number(length) };
}

/** `MioAudio.TryOpen`: the head of a sound of the engine and the sections of it. */
export function readMioLayout(data: Buffer): MioLayout | undefined {
	if (data.length < HEADER_SIZE + SECTION_HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (SUPPORTED_ID !== data.readUInt32LE(ID_OFFSET)) return undefined;
	const name = data.subarray(0x10, 0x10 + MUSIC_NAME.length);
	if (!name.equals(Buffer.from(MUSIC_NAME, "latin1"))) return undefined;
	const layer = readSectionHead(data, HEADER_SIZE);
	if (!layer || layer.id !== HEADER_SECTION || layer.length <= 0) {
		return undefined;
	}
	const bodySize = layer.length;
	if (bodySize > BODY_LIMIT) return undefined;
	const bodyAt = HEADER_SIZE + SECTION_HEADER_SIZE;
	if (bodyAt + bodySize > data.length) return undefined;
	let info: MioInfoHeader | undefined;
	let at = bodyAt;
	let left = bodySize;
	while (left > SECTION_HEADER_SIZE) {
		const section = readSectionHead(data, at);
		if (!section) break;
		at += SECTION_HEADER_SIZE;
		left -= SECTION_HEADER_SIZE;
		if (section.length <= 0 || section.length > left) break;
		if (SOUND_INFO_SECTION === section.id) {
			if (at + 0x30 > data.length) return undefined;
			info = {
				version: data.readInt32LE(at),
				transformation: data.readInt32LE(at + 4),
				architecture: data.readInt32LE(at + 8),
				channelCount: data.readInt32LE(at + 0x0c),
				samplesPerSec: data.readUInt32LE(at + 0x10),
				blocksetCount: data.readUInt32LE(at + 0x14),
				subbandDegree: data.readInt32LE(at + 0x18),
				allSampleCount: data.readUInt32LE(at + 0x1c),
				lappedDegree: data.readUInt32LE(at + 0x20),
				bitsPerSample: data.readUInt32LE(at + 0x24),
			};
			break;
		}
		at += section.length;
		left -= section.length;
	}
	if (!info) return undefined;
	if (1 !== info.channelCount && CHANNEL_LIMIT !== info.channelCount) {
		return undefined;
	}
	// The walk of the places of a sound of the engine stands of the counts of the engine alone
	// (`Lossless_ERI`) or of the walks of a picture of the engine (`LOT_ERI`), of the counts of no sign at
	// all or of the counts of the walk of the engine.
	if (TRANSFORMATION_LOSSLESS_ERI === info.transformation) {
		if (ARCHITECTURE_RUN_LENGTH_HUFFMAN !== info.architecture) {
			return undefined;
		}
		if (
			BITS_PER_SAMPLE_8 !== info.bitsPerSample &&
			BITS_PER_SAMPLE_16 !== info.bitsPerSample
		) {
			return undefined;
		}
	} else if (
		TRANSFORMATION_LOT_ERI === info.transformation ||
		TRANSFORMATION_LOT_ERI_MSS === info.transformation
	) {
		if (BITS_PER_SAMPLE_16 !== info.bitsPerSample) return undefined;
	} else {
		return undefined;
	}
	// The places of the sound of the engine stand of the sections of the head of it (`Stream  `), of the
	// counts of the walk of the engine behind them.
	const streamSection = findSection(data, bodyAt + bodySize, STREAM_SECTION);
	if (!streamSection) return undefined;
	const chunks: MioChunk[] = [];
	let chunkAt = streamSection.at;
	while (chunks.length < CHUNK_LIMIT) {
		const chunk = findSection(data, chunkAt, SOUND_STREAM_SECTION);
		if (!chunk) break;
		if (chunk.length < CHUNK_HEADER_SIZE) break;
		const head = chunk.at;
		const sampleCount = data.readUInt32LE(head + 4);
		const places = data.subarray(head + CHUNK_HEADER_SIZE, head + chunk.length);
		chunks.push({
			offset: head + CHUNK_HEADER_SIZE,
			size: chunk.length - CHUNK_HEADER_SIZE,
			version: data[head] ?? 0,
			flags: data[head + 1] ?? 0,
			sampleCount,
		});
		chunkAt = head + chunk.length;
		if (places.length !== chunk.length - CHUNK_HEADER_SIZE) break;
	}
	if (0 === chunks.length) return undefined;
	return { info, chunks };
}

/** `EriFile.FindSection`: the places of a section of the engine, of the name of it. */
function findSection(
	data: Buffer,
	at: number,
	name: string,
): { at: number; length: number } | undefined {
	let place = at;
	while (place + SECTION_HEADER_SIZE <= data.length) {
		const section = readSectionHead(data, place);
		if (!section) return undefined;
		const head = place + SECTION_HEADER_SIZE;
		if (section.id === name) return { at: head, length: section.length };
		place = head + section.length;
	}
	return undefined;
}

/** `MioDecoder`: the places of a sound of the engine, of the counts of the walk of the engine. */
export class MioDecoder {
	info: MioInfoHeader;

	constructor(info: MioInfoHeader) {
		this.info = info;
	}

	/** `DecodeSound`: the places of a sound of the engine, of a count of the walk of it. */
	decodeSound(chunk: MioChunk, places: Buffer): Uint8Array {
		if (TRANSFORMATION_LOSSLESS_ERI === this.info.transformation) {
			return BITS_PER_SAMPLE_8 === this.info.bitsPerSample
				? this.decodeSoundPcm8(chunk, places)
				: this.decodeSoundPcm16(chunk, places);
		}
		throw unsupportedSound(
			"The places of a sound of the engine stand of the walks of a picture of the engine",
		);
	}

	/** `DecodeSoundPCM8`: the places of a sound of eight places of a count of the walk of it. */
	decodeSoundPcm8(chunk: MioChunk, places: Buffer): Uint8Array {
		const channels = this.info.channelCount;
		const samples = chunk.sampleCount;
		const context = new ErisaHuffmanDecodeContext(0x10000);
		context.attachInputFile(places);
		if (0 !== (chunk.flags & MIO_LEAD_BLOCK)) {
			context.prepareToDecodeErinaCode();
		}
		const decoded = new Uint8Array(samples * channels);
		if (context.decodeBytes(decoded, samples * channels) < samples * channels) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		const out = new Uint8Array(samples * channels);
		let from = 0;
		for (let channel = 0; channel < channels; channel += 1) {
			let to = channel;
			let value = 0;
			for (let sample = 0; sample < samples; sample += 1) {
				value = (value + (((decoded[from] ?? 0) << 24) >> 24)) & 0xff;
				out[to] = value;
				from += 1;
				to += channels;
			}
		}
		return out;
	}

	/** `DecodeSoundPCM16`: the places of a sound of sixteen places of a count of the walk of it. */
	decodeSoundPcm16(chunk: MioChunk, places: Buffer): Uint8Array {
		const channels = this.info.channelCount;
		const samples = chunk.sampleCount;
		const count = samples * channels;
		const context = new ErisaHuffmanDecodeContext(0x10000);
		context.attachInputFile(places);
		if (0 !== (chunk.flags & MIO_LEAD_BLOCK)) {
			context.prepareToDecodeErinaCode();
		}
		const decoded = new Uint8Array(count * 2);
		if (context.decodeBytes(decoded, count * 2) < count * 2) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		// The places of the count of the walk of the engine stand of the places of a count of the sound of
		// the engine of the two ways of it: the count of the places of the walk of a count of no sign at all
		// stands of the count of the walk of the count, and the count of the places of the count behind it.
		const folded = new Uint8Array(count * 2);
		for (let channel = 0; channel < channels; channel += 1) {
			const offset = channel * samples * 2;
			for (let sample = 0; sample < samples; sample += 1) {
				const low = ((decoded[offset + samples + sample] ?? 0) << 24) >> 24;
				const high = ((decoded[offset + sample] ?? 0) << 24) >> 24;
				folded[offset + sample * 2] = low & 0xff;
				folded[offset + sample * 2 + 1] = (high ^ (low >> 7)) & 0xff;
			}
		}
		const out = new Uint8Array(count * 2);
		const view = new DataView(folded.buffer, folded.byteOffset, folded.length);
		for (let channel = 0; channel < channels; channel += 1) {
			const offset = channel * samples * 2;
			let to = channel * 2;
			let value = 0;
			let delta = 0;
			for (let sample = 0; sample < samples; sample += 1) {
				delta = (delta + view.getInt16(offset + sample * 2, true)) | 0;
				value = (value + delta) | 0;
				out[to] = value & 0xff;
				out[to + 1] = (value >> 8) & 0xff;
				to += channels * 2;
			}
		}
		return out;
	}
}

/** The places of a sound of the engine, of every count of the walk of it, one behind the other. */
export function decodeMioSound(data: Buffer, layout: MioLayout): Buffer {
	if (
		TRANSFORMATION_LOT_ERI === layout.info.transformation ||
		TRANSFORMATION_LOT_ERI_MSS === layout.info.transformation
	) {
		throw unsupportedSound(
			"The places of a sound of the engine stand of the walks of a picture of the engine",
		);
	}
	if (ARCHITECTURE_NEMESIS === layout.info.architecture) {
		throw unsupportedSound(
			"The places of a sound of the engine stand of the walk of the Nemesis of it",
		);
	}
	const decoder = new MioDecoder(layout.info);
	const parts: Uint8Array[] = [];
	for (const chunk of layout.chunks) {
		const places = data.subarray(chunk.offset, chunk.offset + chunk.size);
		if (places.length !== chunk.size) {
			throw invalidSound(
				"The count of the walk of the sound stands short of its places",
			);
		}
		parts.push(decoder.decodeSound(chunk, places));
	}
	return Buffer.concat(parts.map((part) => Buffer.from(part)));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const entisMioAudioDescriptor: FormatDescriptor = {
	id: "entis-mio-audio",
	name: "Entis compressed audio",
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
			source: "ArcFormats/Entis/AudioMIO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const entisMioAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: entisMioAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE + SECTION_HEADER_SIZE)) return false;
		try {
			return readMioLayout(await readStored(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readMioLayout(await readStored(source));
		if (!layout) throw invalidSound("Not a sound of the Entis engine");
		const info = layout.info;
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: info.samplesPerSec,
					channels: info.channelCount,
					samples: layout.chunks.reduce(
						(total, chunk) => total + chunk.sampleCount,
						0,
					),
					bitsPerSample: info.bitsPerSample,
					transformation: info.transformation,
					architecture: info.architecture,
				},
			}),
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				compression:
					TRANSFORMATION_LOSSLESS_ERI === info.transformation ? "pcm" : "lot",
				sampleRate: info.samplesPerSec,
				channels: info.channelCount,
				bitsPerSample: info.bitsPerSample,
				chunks: layout.chunks.length,
				transformation: info.transformation,
				architecture: info.architecture,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const data = await readStored(source);
		const layout = readMioLayout(data);
		if (!layout) throw invalidSound("Not a sound of the Entis engine");
		const pcm = decodeMioSound(data, layout);
		const info = layout.info;
		const blockAlign = (info.channelCount * info.bitsPerSample) / 8;
		return Readable.from([
			writeWave(
				{
					formatTag: 1,
					channels: info.channelCount,
					sampleRate: info.samplesPerSec,
					averageBytesPerSecond: info.samplesPerSec * blockAlign,
					blockAlign,
					bitsPerSample: info.bitsPerSample,
				},
				pcm,
			),
		]);
	},
});
