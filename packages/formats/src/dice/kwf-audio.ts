// Format reference: GARbro "Legacy/Dice/AudioKWF.cs", class `KwfAudio` (a standalone audio
// resource: a wave format header followed by raw PCM, which is wrapped in a wave container).
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
} from "../shared/fixed-archive.js";

/** 'KWF0' in little endian. */
const SIGNATURE = Buffer.from("KWF0", "latin1");
const HEADER_SIZE = 0x40;
/** Only one method is implemented; the reference throws for anything else. */
const METHOD_OFFSET = 4;
const SUPPORTED_METHOD = 3;
/** The format block inside the header. */
const FORMAT_TAG_OFFSET = 0x28;
const CHANNELS_OFFSET = 0x2a;
const SAMPLE_RATE_OFFSET = 0x2c;
const BYTES_PER_SECOND_OFFSET = 0x30;
const BLOCK_ALIGN_OFFSET = 0x34;
const BITS_OFFSET = 0x36;

interface KwfFormat {
	formatTag: number;
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
}

interface Layout {
	format: KwfFormat;
}

/** GARbro `KwfAudio.TryOpen`, which copies the wave format straight out of the header. */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (header.readInt32LE(METHOD_OFFSET) !== SUPPORTED_METHOD)
			return undefined;
		return {
			format: {
				formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
				channels: header.readUInt16LE(CHANNELS_OFFSET),
				sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET) >>> 0,
				averageBytesPerSecond:
					header.readUInt32LE(BYTES_PER_SECOND_OFFSET) >>> 0,
				blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
				bitsPerSample: header.readUInt16LE(BITS_OFFSET),
			},
		};
	} catch {
		return undefined;
	}
}

export const kwfAudioDescriptor: FormatDescriptor = {
	id: "dice-kwf-audio",
	name: "DiceSystem audio format",
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
			source: "Legacy/Dice/AudioKWF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kwfAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kwfAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DiceSystem KWF audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// A wave header is prepended, so the payload is longer than the stored region.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "pcm",
				sampleRate: layout.format.sampleRate,
				channels: layout.format.channels,
				bitsPerSample: layout.format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DiceSystem KWF audio");
		// The reference copies every field, including the byte rate and block align, so the header
		// is written verbatim rather than recomputed.
		return Readable.from([writeRiffHeader(layout.format, data.length), data]);
	},
});
