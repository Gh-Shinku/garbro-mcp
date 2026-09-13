// Format reference: GARbro "ArcFormats/Basil/AudioWHC.cs", class `WhcAudio` (a raw PCM resource whose
// wave format block starts the file and which the reference only accepts for a `.whc` name).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeRiffHeader } from "../kapp/asd.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	sourceExtension,
} from "../shared/fixed-archive.js";

/**
 * The reference lists two signatures, which are really the first two header fields: a format tag of one
 * followed by one or two channels, `0x020001` and `0x010001` as little endian words.
 */
const SIGNATURES = [
	Buffer.from([0x01, 0x00, 0x02, 0x00]),
	Buffer.from([0x01, 0x00, 0x01, 0x00]),
];
const HEADER_SIZE = 0x12;
const FORMAT_TAG_OFFSET = 0;
const CHANNELS_OFFSET = 2;
const SAMPLE_RATE_OFFSET = 4;
const AVERAGE_BYTES_OFFSET = 8;
const BLOCK_ALIGN_OFFSET = 0xc;
const BITS_OFFSET = 0xe;
/** The reference reads the payload from here to the end of the file. */
const DATA_OFFSET = 0x12;
const PCM_FORMAT_TAG = 1;
const MAX_CHANNELS = 2;

interface WhcLayout {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
	dataOffset: number;
	dataSize: number;
}

/**
 * GARbro `WhcAudio.TryOpen`: the `.whc` name is required before the header is even read, and the header
 * is a wave format block followed by two unused bytes.
 */
async function readLayout(source: ByteSource): Promise<WhcLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const formatTag = header.readUInt16LE(FORMAT_TAG_OFFSET);
		const channels = header.readUInt16LE(CHANNELS_OFFSET);
		// The reference accepts PCM only, with one or two channels.
		if (formatTag !== PCM_FORMAT_TAG) return undefined;
		if (channels < 1 || channels > MAX_CHANNELS) return undefined;
		return {
			formatTag,
			channels,
			sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET),
			averageBytesPerSecond: header.readUInt32LE(AVERAGE_BYTES_OFFSET),
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample: header.readUInt16LE(BITS_OFFSET),
			dataOffset: DATA_OFFSET,
			dataSize: Number(source.size) - DATA_OFFSET,
		};
	} catch {
		return undefined;
	}
}

/** The reference rejects anything that is not named `.whc` before it reads a byte. */
function isWhcName(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "whc";
}

export const whcAudioDescriptor: FormatDescriptor = {
	id: "basil-whc-audio",
	name: "Basil audio resource",
	extensions: ["whc"],
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
			source: "ArcFormats/Basil/AudioWHC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const whcAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: whcAudioDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return isWhcName(sourcePath) && (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = isWhcName(sourcePath) ? await readLayout(source) : undefined;
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Basil WHC audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(layout.dataOffset),
				size: BigInt(layout.dataSize),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// A RIFF header is prepended, so the payload is longer than the stored PCM.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "pcm",
				formatTag: layout.formatTag,
				channels: layout.channels,
				sampleRate: layout.sampleRate,
				bitsPerSample: layout.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		// The entry opens on the header checks alone, since the name is a `detect` concern.
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Basil WHC audio");
		const pcm = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		// The header carries the whole wave format, and the reference copies it verbatim.
		const riff = writeRiffHeader(
			{
				formatTag: layout.formatTag,
				channels: layout.channels,
				sampleRate: layout.sampleRate,
				averageBytesPerSecond: layout.averageBytesPerSecond,
				blockAlign: layout.blockAlign,
				bitsPerSample: layout.bitsPerSample,
			},
			pcm.length,
		);
		return Readable.from([Buffer.concat([riff, pcm])]);
	},
});
