// Format reference: GARbro "ArcFormats/Ffa/AudioWA2.cs", classes `Wa2Audio` and `Wa2Input` (an FFA System
// sound of the 'APCM' kind: a wave head in front of a walk that takes a nibble at a time and holds the step
// of every one of them). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { WA_SAMPLE_TABLE } from "./wa-core.js";

/** 'APCM', the word the reference registers. */
const SIGNATURE = Buffer.from("APCM", "latin1");
const HEADER_SIZE = 0x2c;
/** The shape of the head of a wave file, which has to stand at eight. */
const WAVE_MARK = Buffer.from("WAVEfmt ", "latin1");
const WAVE_FIELD = 0x08;
const FORMAT_TAG_FIELD = 0x14;
const CHANNELS_FIELD = 0x16;
const SAMPLE_RATE_FIELD = 0x18;
const AVERAGE_FIELD = 0x1c;
const BLOCK_ALIGN_FIELD = 0x20;
const BITS_FIELD = 0x22;
const PCM_SIZE_FIELD = 0x28;
/** The step the walk stands at before it begins. */
const INITIAL_STEP = 0x7f;
/** The greatest step the walk may stand at. */
const MAXIMUM_STEP = 0x6000;
/** The least sound this project will write, and the most, past which the reference would run out of memory. */
const LIMIT = 256 * 1024 * 1024;

export interface Wa2Layout {
	/** The bytes of the sound the head says stand behind it. */
	pcmSize: number;
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
	dataOffset: number;
}

function invalidSound(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

export function readWa2Layout(
	data: Buffer,
	fileLength = data.length,
): Wa2Layout | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!data.subarray(WAVE_FIELD, WAVE_FIELD + WAVE_MARK.length).equals(WAVE_MARK)
	) {
		return undefined;
	}
	const channels = data.readUInt16LE(CHANNELS_FIELD);
	const sampleRate = data.readUInt32LE(SAMPLE_RATE_FIELD);
	const blockAlign = data.readUInt16LE(BLOCK_ALIGN_FIELD);
	const pcmSize = data.readUInt32LE(PCM_SIZE_FIELD);
	if (channels === 0 || sampleRate === 0) return undefined;
	if (pcmSize === 0 || pcmSize > LIMIT) return undefined;
	if (HEADER_SIZE >= fileLength) return undefined;
	return {
		pcmSize,
		formatTag: data.readUInt16LE(FORMAT_TAG_FIELD),
		channels,
		sampleRate,
		averageBytesPerSecond: data.readUInt32LE(AVERAGE_FIELD),
		blockAlign,
		bitsPerSample: data.readUInt16LE(BITS_FIELD),
		dataOffset: HEADER_SIZE,
	};
}

export function decodeWa2(stored: Buffer, layout: Wa2Layout): Buffer {
	const output: Buffer = Buffer.alloc(layout.pcmSize, 0x00);
	let sample = 0;
	let nibbleRead = false;
	let step: number = INITIAL_STEP;
	let inputByte = 0;
	let position = layout.dataOffset;
	let dst = 0;
	while (dst < output.length) {
		let nibble: number;
		if (!nibbleRead) {
			if (position >= stored.length) break;
			inputByte = stored[position] ?? 0;
			position += 1;
			nibble = inputByte >> 4;
		} else {
			nibble = inputByte & 0x0f;
		}
		nibbleRead = !nibbleRead;
		const at = step & 0xffff;
		const difference = (at * (2 * (nibble & 7) + 1)) >> 3;
		if (0 !== (nibble & 8)) {
			sample -= difference;
			if (sample < -32768) sample = -32768;
		} else {
			sample += difference;
			if (sample > 0x7fff) sample = 0x7fff;
		}
		const next = (at * (WA_SAMPLE_TABLE[nibble] ?? 0)) >> 6;
		if (next > 0x7f) {
			step = next < MAXIMUM_STEP + 1 ? next : MAXIMUM_STEP;
		} else {
			step = INITIAL_STEP;
		}
		output.writeUInt16LE(sample & 0xffff, dst);
		dst += 2;
	}
	return output;
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const ffaWa2AudioDescriptor: FormatDescriptor = {
	id: "ffa-wa2-audio",
	name: "FFA System PCM audio format",
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
			source: "ArcFormats/Ffa/AudioWA2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ffaWa2AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ffaWa2AudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
			return readWa2Layout(header, Number(source.size)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = readWa2Layout(await readStored(source), Number(source.size));
		if (!layout) {
			throw invalidSound("Not an FFA System sound");
		}
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.dataOffset),
				size: source.size - BigInt(layout.dataOffset),
				compressed: true,
				metadata: {
					type: "audio",
					sampleRate: layout.sampleRate,
					channels: layout.channels,
					bitsPerSample: layout.bitsPerSample,
				},
			}),
			// The sound is unwrapped and a wave header is written around it.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				codec: "adpcm",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
				bitsPerSample: layout.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const stored = await readStored(source);
		const layout = readWa2Layout(stored, Number(source.size));
		if (!layout) {
			throw invalidSound("Not an FFA System sound");
		}
		const pcm = decodeWa2(stored, layout);
		return Readable.from([
			writeWave(
				{
					formatTag: layout.formatTag,
					channels: layout.channels,
					sampleRate: layout.sampleRate,
					averageBytesPerSecond:
						layout.averageBytesPerSecond === 0
							? layout.sampleRate * layout.blockAlign
							: layout.averageBytesPerSecond,
					blockAlign: layout.blockAlign,
					bitsPerSample: layout.bitsPerSample,
				},
				pcm,
			),
		]);
	},
});
