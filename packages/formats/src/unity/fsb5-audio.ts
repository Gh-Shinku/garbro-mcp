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

const FSB5_MARK = Buffer.from("FSB5", "latin1");
const HEAD_SIZE = 0x3c;
const VERSION_FIELD = 4;
const SAMPLE_COUNT_FIELD = 8;
const SAMPLE_HEADER_SIZE_FIELD = 0xc;
const NAME_TABLE_SIZE_FIELD = 0x10;
const DATA_SIZE_FIELD = 0x14;
const FORMAT_FIELD = 0x18;
const BUTTON_SIZE = 8;
const FOUR_PLACES = 4;
const CHUNK_FIELDS = 4;

const PCM8 = 1;
const PCM16 = 2;
const PCM32 = 4;
const PCM_FLOAT = 5;
const VORBIS = 15;
const CHANNELS_CHUNK = 1;
const RATE_CHUNK = 2;
const LOOP_CHUNK = 3;
const RATE_PLACES = 0xf;
const RATE_SHIFT = 1;
const CHANNEL_SHIFT = 5;
const OFFSET_SHIFT = 6;
const OFFSET_PLACES = 0xfffffff;
const OFFSET_UNIT = 0x10;
const COUNT_SHIFT = 34;
const COUNT_PLACES = 0x3fffffff;
const CHUNK_SIZE_SHIFT = 1;
const CHUNK_SIZE_PLACES = 0xffffff;
const CHUNK_KIND_SHIFT = 25;
const CHUNK_KIND_PLACES = 0x7f;
const LOOP_PLACES = 8;
const LIMIT = 1024 * 1024 * 1024;
const LEASE_LIMIT = 1_000_000;

const RATE_TABLE = new Map<number, number>([
	[1, 8000],
	[2, 11000],
	[3, 11025],
	[4, 16000],
	[5, 22050],
	[6, 24000],
	[7, 32000],
	[8, 44100],
	[9, 48000],
]);

export interface Fsb5Sample {
	sampleRate: number;
	channels: number;
	dataOffset: number;
	sampleCount: number;
}

export interface Fsb5Layout {
	version: number;
	sampleCount: number;
	sampleHeaderSize: number;
	nameTableSize: number;
	dataSize: number;
	format: number;
	headerSize: number;
	dataStart: number;
	samples: Fsb5Sample[];
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readFsb5Layout(
	data: Buffer,
	fileLength = data.length,
): Fsb5Layout | undefined {
	if (fileLength < HEAD_SIZE || data.length < HEAD_SIZE) return undefined;
	if (!data.subarray(0, FSB5_MARK.length).equals(FSB5_MARK)) return undefined;
	const version = data.readInt32LE(VERSION_FIELD);
	const sampleCount = data.readInt32LE(SAMPLE_COUNT_FIELD);
	const sampleHeaderSize = data.readInt32LE(SAMPLE_HEADER_SIZE_FIELD);
	const nameTableSize = data.readInt32LE(NAME_TABLE_SIZE_FIELD);
	const dataSize = data.readInt32LE(DATA_SIZE_FIELD);
	const format = data.readInt32LE(FORMAT_FIELD);
	if (
		format !== PCM8 &&
		format !== PCM16 &&
		format !== PCM32 &&
		format !== PCM_FLOAT
	) {
		if (format === VORBIS)
			throw invalidSound(
				"The places of the picture of the walk of the places of the picture of the sound of the kind of the places of the picture of the walk of them stand beside the places of the picture of the walk of the places of the picture of the picture of the walk of the places of the picture of the sound of the engine, which stand outside the places of the picture of the walk of them of the sound",
			);
		return undefined;
	}
	if (sampleCount <= 0 || sampleCount > LEASE_LIMIT) return undefined;
	if (sampleHeaderSize < 0 || nameTableSize < 0 || dataSize < 0)
		return undefined;
	if (dataSize > LIMIT) return undefined;
	let at = HEAD_SIZE;
	if (version === 0) at += FOUR_PLACES;
	if (at > data.length) return undefined;
	const headerSize = at;
	const dataStart = headerSize + sampleHeaderSize + nameTableSize;
	if (dataStart > fileLength || dataStart > data.length) return undefined;
	const samples: Fsb5Sample[] = [];
	for (let i = 0; i < sampleCount; i += 1) {
		if (at + BUTTON_SIZE > data.length) return undefined;
		const raw = data.readBigInt64LE(at);
		at += BUTTON_SIZE;
		let nextChunk = (raw & 1n) !== 0n;
		const rateIndex = Number((raw >> BigInt(RATE_SHIFT)) & BigInt(RATE_PLACES));
		const channels = Number((raw >> BigInt(CHANNEL_SHIFT)) & 1n) + 1;
		const dataOffset =
			Number((raw >> BigInt(OFFSET_SHIFT)) & BigInt(OFFSET_PLACES)) *
			OFFSET_UNIT;
		const sampleCount2 = Number(
			(raw >> BigInt(COUNT_SHIFT)) & BigInt(COUNT_PLACES),
		);
		let chunkRate: number | undefined;
		while (nextChunk) {
			if (at + CHUNK_FIELDS > data.length) return undefined;
			const fields = data.readInt32LE(at);
			at += CHUNK_FIELDS;
			nextChunk = (fields & 1) !== 0;
			const chunkSize = (fields >> CHUNK_SIZE_SHIFT) & CHUNK_SIZE_PLACES;
			const chunkKind = (fields >> CHUNK_KIND_SHIFT) & CHUNK_KIND_PLACES;
			if (chunkSize < 0 || at + chunkSize > data.length) return undefined;
			if (chunkKind === CHANNELS_CHUNK) at += 1;
			else if (chunkKind === RATE_CHUNK) {
				if (at + FOUR_PLACES > data.length) return undefined;
				chunkRate = data.readInt32LE(at);
				at += FOUR_PLACES;
			} else if (chunkKind === LOOP_CHUNK) at += LOOP_PLACES;
			else at += chunkSize;
		}
		let sampleRate = chunkRate;
		if (sampleRate === undefined) sampleRate = RATE_TABLE.get(rateIndex);
		if (sampleRate === undefined)
			throw invalidSound(
				"The places of the picture of the walk of the places of the picture of the sound stand of no places of the picture of the walk of the places of the picture of the sound of the kind of the places of the picture behind them",
			);
		samples.push({
			sampleRate,
			channels,
			dataOffset,
			sampleCount: sampleCount2,
		});
	}
	return {
		version,
		sampleCount,
		sampleHeaderSize,
		nameTableSize,
		dataSize,
		format,
		headerSize,
		dataStart,
		samples,
	};
}

export function unpackFsb5Pcm(
	data: Buffer,
	layout: Fsb5Layout,
): { pcm: Buffer; bitsPerSample: number; formatTag: number } | undefined {
	const first = layout.samples[0];
	if (!first) return undefined;
	const second = layout.samples[1];
	const length = second
		? second.dataOffset - first.dataOffset
		: layout.dataSize;
	if (length < 0) return undefined;
	if (layout.dataStart + length > data.length) return undefined;
	const bitsPerSample =
		layout.format === PCM8 ? 8 : layout.format === PCM16 ? 16 : 32;
	return {
		pcm: Buffer.from(
			data.subarray(layout.dataStart, layout.dataStart + length),
		),
		bitsPerSample,
		formatTag: layout.format === PCM_FLOAT ? 3 : 1,
	};
}

export function readFsb5Wave(data: Buffer, layout: Fsb5Layout): Buffer {
	const places = unpackFsb5Pcm(data, layout);
	if (!places)
		throw invalidSound(
			"No places of the picture of the walk of the places of the picture",
		);
	const first = layout.samples[0];
	if (!first)
		throw invalidSound(
			"No places of the picture of the walk of the places of the picture",
		);
	const blockAlign = (first.channels * places.bitsPerSample) / 8;
	return writeWave(
		{
			formatTag: places.formatTag,
			channels: first.channels,
			sampleRate: first.sampleRate,
			blockAlign,
			averageBytesPerSecond: blockAlign * first.sampleRate,
			bitsPerSample: places.bitsPerSample,
		},
		places.pcm,
	);
}

export const unityFsb5AudioDescriptor: FormatDescriptor = {
	id: "unity-fsb5-audio",
	name: "FMOD Sample Bank audio format",
	extensions: ["fsb"],
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
			source: "ArcFormats/Unity/AudioFSB5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const unityFsb5AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: unityFsb5AudioDescriptor,
	detection: { signatures: [{ bytes: FSB5_MARK }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEAD_SIZE)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x1000)),
			);
			const layout = readFsb5Layout(data, Number(source.size));
			return layout !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readFsb5Layout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a sound of this kind");
		const first = layout.samples[0];
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "wav"),
					offset: BigInt(layout.dataStart),
					size: source.size - BigInt(layout.dataStart),
					compressed: false,
					metadata: {
						type: "audio",
						channels: first?.channels ?? 0,
						sampleRate: first?.sampleRate ?? 0,
						sampleCount: first?.sampleCount ?? 0,
						format: layout.format,
					},
				}),
			],
			metadata: {
				audio: "wav",
				format: layout.format,
				samples: layout.sampleCount,
				channels: first?.channels ?? 0,
				sampleRate: first?.sampleRate ?? 0,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readFsb5Layout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a sound of this kind");
		return Readable.from([readFsb5Wave(stored, layout)]);
	},
});
