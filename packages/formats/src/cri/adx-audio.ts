import { GarbroError } from "@garbro-mcp/core";
import { MsbBitReader } from "@garbro-mcp/codecs";
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

const SIGNATURE_SIZE = 4;
const LEAST_HEADER = 0x10;
const WORDS_OF_THE_HEAD = 0x80;
const COPYRIGHT = Buffer.from("(c)CRI", "latin1");
const COPYRIGHT_SIZE = 6;
const VERSION_FIELD = 0;
const FRAME_SIZE_FIELD = 1;
const FRAME_BITS_FIELD = 2;
const CHANNELS_FIELD = 3;
const RATE_FIELD = 4;
const SAMPLES_FIELD = 8;
const LOWEST_FIELD = 12;
const ENCODING_FIELD = 0x0e;
const ADX_VERSION = 3;
const ADX_FRAME_SIZE = 0x12;
const ADX_BITS = 4;
const ADX_ENCODING = 0x0400;
const MOST_CHANNELS = 16;
const OUTPUT_BITS = 16;
const PLACES_PER_WORD = 8;
const HIGHEST_SAMPLE = 0x7fff;
const LOWEST_SAMPLE = -0x8000;
const SIGN_PLACE = 8;
const WORTH_PLACES = 7;
const SCALE_SHIFT = 12;
const SCALE_PLACES = 8192;
const SECOND_SCALE_PLACES = -4096;
const LIMIT = 64 * 1024 * 1024;

export interface AdxLayout {
	headerSize: number;
	channels: number;
	samplesPerSecond: number;
	sampleCount: number;
	frameSize: number;
	samplesPerFrame: number;
	dataOffset: number;
	scale: number;
	secondScale: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readAdxLayout(
	data: Buffer,
	fileLength = data.length,
): AdxLayout | undefined {
	if (fileLength < SIGNATURE_SIZE || data.length < SIGNATURE_SIZE)
		return undefined;
	if (data.readUInt16BE(2) !== WORDS_OF_THE_HEAD) return undefined;
	const headerSize = data.readUInt16BE(0);
	if (headerSize < LEAST_HEADER || headerSize >= fileLength) return undefined;
	if (SIGNATURE_SIZE + headerSize > data.length) return undefined;
	const head = SIGNATURE_SIZE;
	if (data[head + FRAME_SIZE_FIELD] !== ADX_FRAME_SIZE) return undefined;
	if (data[head + FRAME_BITS_FIELD] !== ADX_BITS) return undefined;
	if (data[head + VERSION_FIELD] !== ADX_VERSION) return undefined;
	if (
		!data
			.subarray(
				SIGNATURE_SIZE + headerSize - COPYRIGHT_SIZE,
				SIGNATURE_SIZE + headerSize,
			)
			.equals(COPYRIGHT)
	)
		return undefined;
	const channels = data[head + CHANNELS_FIELD] ?? 0;
	if (channels === 0 || channels > MOST_CHANNELS) return undefined;
	if (data.readInt16BE(head + ENCODING_FIELD) !== ADX_ENCODING)
		return undefined;
	const samplesPerSecond = data.readUInt32BE(head + RATE_FIELD);
	const sampleCount = data.readInt32BE(head + SAMPLES_FIELD);
	if (samplesPerSecond === 0 || sampleCount <= 0) return undefined;
	if (sampleCount * channels * 2 > LIMIT) return undefined;
	const frameSize = data[head + FRAME_SIZE_FIELD] ?? 0;
	const samplesPerFrame = ((frameSize - 2) * PLACES_PER_WORD) / ADX_BITS;
	if (samplesPerFrame <= 0) return undefined;
	const lowestFreq = data.readUInt16BE(head + LOWEST_FIELD);
	const root = Math.sqrt(2.0);
	const x = root - Math.cos((2 * Math.PI * lowestFreq) / samplesPerSecond);
	const y = root - 1;
	const z = (x - Math.sqrt((x + y) * (x - y))) / y;
	return {
		headerSize,
		channels,
		samplesPerSecond,
		sampleCount,
		frameSize,
		samplesPerFrame,
		dataOffset: SIGNATURE_SIZE + headerSize,
		scale: Math.floor(z * SCALE_PLACES),
		secondScale: Math.floor(z * z * SECOND_SCALE_PLACES),
	};
}

function nibbleToSigned(place: number): number {
	return (place & WORTH_PLACES) - (place & SIGN_PLACE);
}

function clamp16(sample: number): number {
	if (sample > HIGHEST_SAMPLE) return HIGHEST_SAMPLE;
	if (sample < LOWEST_SAMPLE) return LOWEST_SAMPLE;
	return sample;
}

function decodeAdxFrame(
	reader: MsbBitReader,
	layout: AdxLayout,
	history: number[][],
	channel: number,
	pcm: Buffer,
	frameStart: number,
	keep: number,
): void {
	const track = history[channel];
	if (!track)
		throw invalidSound(
			"The places of the picture of the walk of the places of the picture stand nowhere",
		);
	const scale = ((reader.readBits(OUTPUT_BITS) << 16) >> 16) + 1;
	for (let i = 0; i < layout.samplesPerFrame; i += 1) {
		const nibble = nibbleToSigned(reader.readBits(ADX_BITS));
		const previous = track[0] ?? 0;
		const before = track[1] ?? 0;
		const adjust =
			(layout.scale * previous + layout.secondScale * before) >> SCALE_SHIFT;
		const sample = clamp16(nibble * scale + adjust);
		if (i < keep) {
			const at = (frameStart + i) * layout.channels * 2 + channel * 2;
			pcm.writeInt16LE(sample, at);
		}
		track[1] = previous;
		track[0] = sample;
	}
}

export function unpackAdxPcm(data: Buffer, layout: AdxLayout): Buffer {
	const pcm = Buffer.alloc(layout.sampleCount * layout.channels * 2);
	const reader = new MsbBitReader(data, layout.dataOffset);
	const history: number[][] = [];
	for (let channel = 0; channel < layout.channels; channel += 1)
		history.push([0, 0]);
	let sample = 0;
	while (sample < layout.sampleCount) {
		const keep = Math.min(layout.sampleCount - sample, layout.samplesPerFrame);
		for (let channel = 0; channel < layout.channels; channel += 1)
			decodeAdxFrame(reader, layout, history, channel, pcm, sample, keep);
		sample += keep;
	}
	return pcm;
}

export function readAdxWave(data: Buffer, layout: AdxLayout): Buffer {
	const blockAlign = (OUTPUT_BITS * layout.channels) / PLACES_PER_WORD;
	return writeWave(
		{
			formatTag: 1,
			channels: layout.channels,
			sampleRate: layout.samplesPerSecond,
			blockAlign,
			averageBytesPerSecond: blockAlign * layout.samplesPerSecond,
			bitsPerSample: OUTPUT_BITS,
		},
		unpackAdxPcm(data, layout),
	);
}

export const criAdxAudioDescriptor: FormatDescriptor = {
	id: "cri-adx-audio",
	name: "CRI MiddleWare ADPCM audio",
	extensions: ["adx"],
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
			source: "ArcFormats/Cri/AudioADX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const criAdxAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: criAdxAudioDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(SIGNATURE_SIZE)) return false;
		try {
			const data = Buffer.from(
				await source.readAt(0n, Math.min(Number(source.size), 0x200)),
			);
			return readAdxLayout(data, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readAdxLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a sound of this kind");
		return {
			entries: [
				createFixedEntry({
					id: 0,
					path: changeExtension(sourcePath.replace(/^.*[/\\]/, ""), "wav"),
					offset: BigInt(layout.dataOffset),
					size: source.size - BigInt(layout.dataOffset),
					compressed: true,
					metadata: {
						type: "audio",
						channels: layout.channels,
						sampleRate: layout.samplesPerSecond,
						sampleCount: layout.sampleCount,
					},
				}),
			],
			metadata: {
				audio: "wav",
				channels: layout.channels,
				sampleRate: layout.samplesPerSecond,
				sampleCount: layout.sampleCount,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		const layout = readAdxLayout(stored, Number(source.size));
		if (!layout) throw invalidSound("Not a sound of this kind");
		return Readable.from([readAdxWave(stored, layout)]);
	},
});
