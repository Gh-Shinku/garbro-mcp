import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
} from "../shared/fixed-archive.js";
import { writeWave } from "../shared/wav.js";

const HEAD_SIZE = 0x28;
const PCM_SIZE_FIELD = 0x14;
const SAMPLE_COUNT_FIELD = 0x1c;
const PACKED_SIZE_FIELD = 0x18;
const BLOCK_COUNT_FIELD = 0x10;
const BLOCK_SIZE_FIELD = 0x20;
const FINAL_BLOCK_SIZE_FIELD = 0x24;
const COMPRESSION_FIELD = 8;
const RUN_LENGTH_FIELD = 0xc;
const DATA_OFFSET = 0x2c;
const CHANNELS_FIELD = 0;
const BITS_FIELD = 2;
const RATE_FIELD = 4;
const RAW_COMPRESSION = -1;
const MOST_COMPRESSION = 5;
const LEAST_COMPRESSION = 3;
const LONG_PLACES = 7;
const PLACES_PER_WORD = 8;
const LOST_PLACES = 8;
const LONGEST_RUN = 3;
/** Default bound for one decoded sound; callers can lower or raise it when constructing the registry. */
export const DEFAULT_NWA_MAX_DECODED_BYTES = 256 * 1024 * 1024;
const WAVE_HEADER_SIZE = 0x2c;

export interface NwaLayout {
	channels: number;
	bitsPerSample: number;
	samplesPerSecond: number;
	compression: number;
	runLengthEncoded: boolean;
	blockCount: number;
	pcmSize: number;
	packedSize: number;
	sampleCount: number;
	blockSize: number;
	finalBlockSize: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function audioMetadata(layout: NwaLayout): Record<string, string | number> {
	const blockAlign = (layout.channels * layout.bitsPerSample) / PLACES_PER_WORD;
	const sampleFrames = layout.pcmSize / blockAlign;
	return {
		type: "audio",
		decoderId: "reallive-nwa",
		channels: layout.channels,
		bitsPerSample: layout.bitsPerSample,
		sampleRate: layout.samplesPerSecond,
		blockAlign,
		decodedBytes: layout.pcmSize,
		serializedBytes: WAVE_HEADER_SIZE + layout.pcmSize,
		sampleFrames,
		durationSeconds: sampleFrames / layout.samplesPerSecond,
		compression: layout.compression,
	};
}

export function readNwaLayout(
	data: Buffer,
	fileLength = data.length,
	maxDecodedBytes = DEFAULT_NWA_MAX_DECODED_BYTES,
): NwaLayout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	if (channels === 0 || channels > 2) return undefined;
	const bitsPerSample = data.readUInt16LE(BITS_FIELD);
	if (bitsPerSample !== 8 && bitsPerSample !== 16) return undefined;
	const samplesPerSecond = data.readUInt32LE(RATE_FIELD);
	if (samplesPerSecond === 0) return undefined;
	const layout: NwaLayout = {
		channels,
		bitsPerSample,
		samplesPerSecond,
		compression: data.readInt32LE(COMPRESSION_FIELD),
		runLengthEncoded: data.readInt32LE(RUN_LENGTH_FIELD) !== 0,
		blockCount: data.readInt32LE(BLOCK_COUNT_FIELD),
		pcmSize: data.readInt32LE(PCM_SIZE_FIELD),
		packedSize: data.readInt32LE(PACKED_SIZE_FIELD),
		sampleCount: data.readInt32LE(SAMPLE_COUNT_FIELD),
		blockSize: data.readInt32LE(BLOCK_SIZE_FIELD),
		finalBlockSize: data.readInt32LE(FINAL_BLOCK_SIZE_FIELD),
	};
	layout.packedSize = data.readInt32LE(0x18);
	if (layout.pcmSize <= 0) return undefined;
	if (layout.pcmSize > maxDecodedBytes)
		throw new GarbroError(
			"LIMIT_EXCEEDED",
			`NWA decoded PCM size ${layout.pcmSize} exceeds the ${maxDecodedBytes} byte policy limit`,
			{
				details: {
					decodedBytes: layout.pcmSize,
					maxDecodedBytes,
				},
			},
		);
	const blockAlign = (layout.channels * layout.bitsPerSample) / PLACES_PER_WORD;
	if (layout.pcmSize % blockAlign !== 0) return undefined;
	if (layout.compression === RAW_COMPRESSION) {
		if (layout.pcmSize > fileLength - DATA_OFFSET) return undefined;
		return layout;
	}
	if (layout.compression > MOST_COMPRESSION) return undefined;
	if (
		layout.pcmSize !==
		Math.floor((layout.sampleCount * layout.bitsPerSample) / PLACES_PER_WORD)
	)
		return undefined;
	if (layout.blockCount <= 0) return undefined;
	if (layout.blockSize <= 0) return undefined;
	return layout;
}

class NwaBitReader {
	private bits = 0;
	private cachedBits = 0;
	position: number;

	constructor(
		private readonly input: Buffer,
		position: number,
	) {
		this.position = position;
	}

	reset(): void {
		this.cachedBits = 0;
	}

	getBits(count: number): number {
		if (this.cachedBits >= count) {
			const mask = (1 << count) - 1;
			const value = this.bits & mask;
			this.bits >>>= count;
			this.cachedBits -= count;
			return value;
		}
		let value = this.bits & ((1 << this.cachedBits) - 1);
		let left = count - this.cachedBits;
		let shift = this.cachedBits;
		this.cachedBits = 0;
		while (left >= PLACES_PER_WORD) {
			if (this.position >= this.input.length) return -1;
			value |= (this.input[this.position] ?? 0) << shift;
			this.position += 1;
			shift += PLACES_PER_WORD;
			left -= PLACES_PER_WORD;
		}
		if (left > 0) {
			if (this.position >= this.input.length) return -1;
			const place = this.input[this.position] ?? 0;
			this.position += 1;
			value |= (place & ((1 << left) - 1)) << shift;
			this.bits = place >> left;
			this.cachedBits = PLACES_PER_WORD - left;
		}
		return value;
	}

	nextBit(): number {
		return this.getBits(1);
	}
}

function readNwaPlaces(
	reader: NwaBitReader,
	sample: number[],
	channel: number,
	bits: number,
	shift: number,
): boolean {
	const signBit = 1 << (bits - 1);
	const mask = signBit - 1;
	const value = reader.getBits(bits);
	if (value < 0) return false;
	const magnitude = (((value & mask) << shift) << 16) >> 16;
	const current = sample[channel] ?? 0;
	sample[channel] =
		(((value & signBit) !== 0 ? current - magnitude : current + magnitude) <<
			16) >>
		16;
	return true;
}

function decodeNwaBlock(
	data: Buffer,
	reader: NwaBitReader,
	layout: NwaLayout,
	pcm: Buffer,
	dst: number,
	blockSize: number,
): number {
	const sample = new Array<number>(layout.channels).fill(0);
	for (let channel = 0; channel < layout.channels; channel += 1) {
		if (layout.bitsPerSample === PLACES_PER_WORD) {
			if (reader.position >= data.length)
				throw invalidSound(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			sample[channel] = data[reader.position] ?? 0;
			reader.position += 1;
		} else {
			if (reader.position + 2 > data.length)
				throw invalidSound(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			sample[channel] = data.readInt16LE(reader.position);
			reader.position += 2;
		}
	}
	reader.reset();
	let at = dst;
	let channel = 0;
	let repeatCount = 0;
	for (let i = 0; i < blockSize; i += 1) {
		if (repeatCount === 0) {
			const control = reader.getBits(3);
			if (control < 0)
				throw invalidSound(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			if (control === LONG_PLACES) {
				if (reader.nextBit() === 1) {
					sample[channel] = 0;
				} else {
					const bits =
						layout.compression < LEAST_COMPRESSION
							? LOST_PLACES - layout.compression
							: LOST_PLACES;
					const shift =
						layout.compression < LEAST_COMPRESSION
							? LOST_PLACES + 1 + layout.compression
							: LOST_PLACES + 1;
					if (!readNwaPlaces(reader, sample, channel, bits, shift))
						throw invalidSound(
							"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
						);
				}
			} else if (control !== 0) {
				const bits =
					layout.compression < LEAST_COMPRESSION
						? 5 - layout.compression
						: 3 + layout.compression;
				const shift =
					layout.compression < LEAST_COMPRESSION
						? 2 + control + layout.compression
						: 1 + control;
				if (!readNwaPlaces(reader, sample, channel, bits, shift))
					throw invalidSound(
						"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
					);
			} else if (layout.runLengthEncoded) {
				repeatCount = reader.nextBit();
				if (repeatCount === 1) {
					repeatCount = reader.getBits(2);
					if (repeatCount === LONGEST_RUN) repeatCount = reader.getBits(8);
					if (repeatCount < 0)
						throw invalidSound(
							"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
						);
				}
			}
		} else {
			repeatCount -= 1;
		}
		if (at + layout.bitsPerSample / PLACES_PER_WORD > pcm.length)
			throw invalidSound(
				"The places of the picture of the walk of the places of the picture stand past the places of the picture",
			);
		const value = sample[channel] ?? 0;
		if (layout.bitsPerSample === PLACES_PER_WORD) {
			pcm[at] = value & 0xff;
			at += 1;
		} else {
			pcm.writeInt16LE(value, at);
			at += 2;
		}
		if (layout.channels === 2) channel ^= 1;
	}
	return at;
}

export function unpackNwaPcm(data: Buffer, layout: NwaLayout): Buffer {
	const pcm = Buffer.alloc(layout.pcmSize);
	if (layout.compression === RAW_COMPRESSION) {
		data.copy(
			pcm,
			0,
			DATA_OFFSET,
			DATA_OFFSET + Math.min(layout.pcmSize, data.length - DATA_OFFSET),
		);
		return pcm;
	}
	const offsets: number[] = [];
	for (let i = 0; i < layout.blockCount; i += 1) {
		if (DATA_OFFSET + (i + 1) * 4 > data.length)
			throw invalidSound(
				"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
			);
		offsets.push(data.readUInt32LE(DATA_OFFSET + i * 4));
	}
	let dst = 0;
	for (let i = 0; i < offsets.length - 1; i += 1) {
		const offset = offsets[i] ?? 0;
		const nextOffset = offsets[i + 1] ?? 0;
		if (offset > data.length || nextOffset <= offset)
			throw invalidSound("The NWA block offsets are invalid");
		const reader = new NwaBitReader(data, offset);
		dst = decodeNwaBlock(data, reader, layout, pcm, dst, layout.blockSize);
	}
	const last = offsets[offsets.length - 1] ?? 0;
	if (last > data.length)
		throw invalidSound(
			"The places of the picture of the walk of the places of the picture stand past the places of the picture",
		);
	const reader = new NwaBitReader(data, last);
	dst = decodeNwaBlock(
		data,
		reader,
		layout,
		pcm,
		dst,
		layout.finalBlockSize > 0 ? layout.finalBlockSize : layout.blockSize,
	);
	if (dst !== pcm.length) {
		throw invalidSound(
			`The NWA decoder produced ${dst} PCM bytes instead of ${pcm.length}`,
		);
	}
	return pcm;
}

export function readNwaWave(data: Buffer, layout: NwaLayout): Buffer {
	return writeWave(
		{
			formatTag: 1,
			channels: layout.channels,
			sampleRate: layout.samplesPerSecond,
			blockAlign: (layout.channels * layout.bitsPerSample) / PLACES_PER_WORD,
			averageBytesPerSecond:
				((layout.channels * layout.bitsPerSample) / PLACES_PER_WORD) *
				layout.samplesPerSecond,
			bitsPerSample: layout.bitsPerSample,
		},
		unpackNwaPcm(data, layout),
	);
}

export const realliveNwaAudioDescriptor: FormatDescriptor = {
	id: "reallive-nwa-audio",
	name: "RealLive engine audio format",
	extensions: ["nwa"],
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
			source: "ArcFormats/RealLive/AudioNWA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export function createRealliveNwaAudioFormat(
	maxDecodedBytes = DEFAULT_NWA_MAX_DECODED_BYTES,
): ArchiveFormat {
	if (!Number.isSafeInteger(maxDecodedBytes) || maxDecodedBytes <= 0)
		throw new GarbroError(
			"INVALID_ARGUMENT",
			"NWA maxDecodedBytes must be a positive safe integer",
		);
	return defineFixedArchive({
		descriptor: realliveNwaAudioDescriptor,
		detection: { signatures: [], priority: -1 },
		async detect(source: ByteSource): Promise<boolean> {
			if (source.size < BigInt(HEAD_SIZE)) return false;
			try {
				const data = Buffer.from(
					await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
				);
				const layout = readNwaLayout(
					data,
					Number(source.size),
					maxDecodedBytes,
				);
				if (!layout) return false;
				if (
					layout.compression !== RAW_COMPRESSION &&
					layout.blockCount > 0 &&
					DATA_OFFSET + layout.blockCount * 4 > source.size
				)
					return false;
				return true;
			} catch (error) {
				if (error instanceof GarbroError && error.code === "LIMIT_EXCEEDED")
					throw error;
				return false;
			}
		},
		async read(source: ByteSource, sourcePath: string) {
			const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
			const layout = readNwaLayout(
				stored,
				Number(source.size),
				maxDecodedBytes,
			);
			if (!layout) throw invalidSound("Not a sound of this kind");
			return {
				entries: [
					createFixedEntry({
						id: 0,
						path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "wav"),
						offset: 0n,
						size: BigInt(WAVE_HEADER_SIZE + layout.pcmSize),
						packedSize: source.size,
						compressed: layout.compression !== RAW_COMPRESSION,
						metadata: audioMetadata(layout),
					}),
				],
				metadata: {
					audio: "wav",
					...audioMetadata(layout),
				},
			};
		},
		async openEntry(source: ByteSource) {
			const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
			const layout = readNwaLayout(
				stored,
				Number(source.size),
				maxDecodedBytes,
			);
			if (!layout) throw invalidSound("Not a sound of this kind");
			return Readable.from([readNwaWave(stored, layout)]);
		},
	});
}

export const realliveNwaAudioFormat = createRealliveNwaAudioFormat();
