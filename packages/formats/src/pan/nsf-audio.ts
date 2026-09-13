// Format reference: GARbro "Legacy/Pan/AudioNSF.cs", class `NsfAudio` (Pan engine PCM audio, recognised
// by its extension and by an internal consistency check on the format block). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const HEADER_SIZE = 0x10;
const FORMAT_TAG_OFFSET = 0;
const CHANNELS_OFFSET = 2;
const SAMPLE_RATE_OFFSET = 4;
/** The average byte rate is stored as a sixteen bit field here, not the usual thirty two. */
const AVERAGE_BYTES_OFFSET = 8;
const BLOCK_ALIGN_OFFSET = 0xc;
const BITS_OFFSET = 0xe;
const PCM_OFFSET = 0x10;
/** The only format tag `TryOpen` accepts. */
const PCM_FORMAT_TAG = 1;

interface NsfLayout {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

/** The reference gates on `.NSF` before reading anything. */
function hasExtension(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "nsf";
}

/**
 * `NsfAudio.TryOpen`: the name must end in `.NSF` and the format block must be internally consistent —
 * the tag has to be plain PCM and the average byte rate has to equal the value derived from the sample
 * rate, the channel count and the bit depth. Its two registered signature words are just the first two
 * header fields read as one little endian word, which is why this port registers none.
 */
async function readLayout(source: ByteSource): Promise<NsfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const layout: NsfLayout = {
			formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
			channels: header.readUInt16LE(CHANNELS_OFFSET),
			sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET),
			averageBytesPerSecond: header.readUInt16LE(AVERAGE_BYTES_OFFSET),
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample: header.readUInt16LE(BITS_OFFSET),
		};
		if (layout.formatTag !== PCM_FORMAT_TAG) return undefined;
		const derived = Math.floor(
			(layout.sampleRate * layout.channels * layout.bitsPerSample) / 8,
		);
		if (derived !== layout.averageBytesPerSecond) return undefined;
		return layout;
	} catch {
		return undefined;
	}
}

export const nsfAudioDescriptor: FormatDescriptor = {
	id: "pan-nsf-audio",
	name: "Pan engine PCM audio",
	extensions: ["nsf"],
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
			source: "Legacy/Pan/AudioNSF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nsfAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nsfAudioDescriptor,
	// The reference's signature list is derived from the format fields, so nothing is registered here.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pan NSF audio");
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pan NSF audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(PCM_OFFSET),
				size: source.size - BigInt(PCM_OFFSET),
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
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pan NSF audio");
		// The reference plays everything from `0x10` to the end of the file.
		const pcm = Buffer.from(
			await source.readAt(BigInt(PCM_OFFSET), Number(source.size) - PCM_OFFSET),
		);
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
