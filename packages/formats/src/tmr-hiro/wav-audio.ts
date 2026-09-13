// Format reference: GARbro "ArcFormats/Tmr-Hiro/AudioTmr.cs", class `TmrHiroAudio` (a nine byte header
// and raw PCM in a single fixed format). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
// MIT License.

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

/** The reference has no signature at all; the first byte and the length relation decide. */
const FIRST_BYTE = 0x44;
const MARKER_OFFSET = 4;
/** The header is nine bytes: the first byte, three free bytes, a zero byte and a length. */
const HEADER_SIZE = 9;
const LENGTH_OFFSET = 5;
/** The reference hard codes this format rather than reading it from the file. */
const CHANNELS = 2;
const SAMPLE_RATE = 44100;
const BITS_PER_SAMPLE = 16;
const BLOCK_ALIGN = 4;
const AVERAGE_BYTES_PER_SECOND = SAMPLE_RATE * BLOCK_ALIGN;

interface TmrLayout {
	dataOffset: number;
	dataSize: number;
}

/**
 * GARbro `TmrHiroAudio.TryOpen`: byte 0 must be `0x44`, the byte at offset 4 must be zero, and the
 * signed length at offset 5 must be exactly the file length minus the nine byte header.
 */
async function readLayout(source: ByteSource): Promise<TmrLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.readUInt8(0) !== FIRST_BYTE) return undefined;
		if (header.readUInt8(MARKER_OFFSET) !== 0) return undefined;
		const length = header.readInt32LE(LENGTH_OFFSET);
		if (BigInt(length) !== source.size - BigInt(HEADER_SIZE)) return undefined;
		return { dataOffset: HEADER_SIZE, dataSize: length };
	} catch {
		return undefined;
	}
}

export const tmrHiroAudioDescriptor: FormatDescriptor = {
	id: "tmr-hiro-wav-audio",
	name: "Tmr-Hiro wave audio",
	// The reference registers the empty extension, i.e. extension-less names.
	extensions: [""],
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
			source: "ArcFormats/Tmr-Hiro/AudioTmr.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const tmrHiroAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tmrHiroAudioDescriptor,
	// No signature: the length relation is the whole detection.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tmr-Hiro wave audio");
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
				channels: CHANNELS,
				sampleRate: SAMPLE_RATE,
				bitsPerSample: BITS_PER_SAMPLE,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tmr-Hiro wave audio");
		const pcm = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		// The reference hard codes the format, so these values never come from the file.
		const riff = writeRiffHeader(
			{
				formatTag: 1,
				channels: CHANNELS,
				sampleRate: SAMPLE_RATE,
				averageBytesPerSecond: AVERAGE_BYTES_PER_SECOND,
				blockAlign: BLOCK_ALIGN,
				bitsPerSample: BITS_PER_SAMPLE,
			},
			pcm.length,
		);
		return Readable.from([Buffer.concat([riff, pcm])]);
	},
});
