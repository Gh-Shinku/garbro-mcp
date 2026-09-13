// Format reference: GARbro "ArcFormats/Leaf/AudioW.cs", class `WAudio` (Leaf PCM audio, recognised by
// its extension and a set of consistency checks rather than a signature). GARbro commit
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

const HEADER_SIZE = 0x12;
/** The reference hard codes plain PCM, since the file stores no format tag. */
const FORMAT_TAG = 1;
const CHANNELS_OFFSET = 0;
const BLOCK_ALIGN_OFFSET = 1;
const SAMPLE_RATE_OFFSET = 2;
const BITS_OFFSET = 4;
const AVERAGE_BYTES_OFFSET = 6;
const PCM_SIZE_OFFSET = 0xa;
const PCM_OFFSET = 0x12;

interface WLayout {
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
	dataSize: number;
}

/** The reference gates on the `w` extension before reading anything. */
function hasExtension(sourcePath: string): boolean {
	return sourceExtension(sourcePath).toLowerCase() === "w";
}

/**
 * `WAudio.TryOpen` has no signature to rely on, so it validates the header instead: the sample rate times
 * the block align has to equal the average byte rate, the channel count has to be in `1..8`, the bit depth
 * at least eight, neither the average rate nor the PCM size may be zero, and the file has to be exactly as
 * long as the header plus the PCM.
 */
async function readLayout(source: ByteSource): Promise<WLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const channels = header[CHANNELS_OFFSET] ?? 0;
		const blockAlign = header[BLOCK_ALIGN_OFFSET] ?? 0;
		const sampleRate = header.readUInt16LE(SAMPLE_RATE_OFFSET);
		const bitsPerSample = header.readUInt16LE(BITS_OFFSET);
		const averageBytesPerSecond = header.readUInt32LE(AVERAGE_BYTES_OFFSET);
		const dataSize = header.readUInt32LE(PCM_SIZE_OFFSET);
		if (dataSize === 0 || averageBytesPerSecond === 0) return undefined;
		if (bitsPerSample < 8) return undefined;
		if (channels === 0 || channels > 8) return undefined;
		if (blockAlign * sampleRate !== averageBytesPerSecond) return undefined;
		if (BigInt(dataSize) + BigInt(HEADER_SIZE) !== source.size)
			return undefined;
		return {
			channels,
			sampleRate,
			averageBytesPerSecond,
			blockAlign,
			bitsPerSample,
			dataSize,
		};
	} catch {
		return undefined;
	}
}

export const leafWAudioDescriptor: FormatDescriptor = {
	id: "leaf-w-audio",
	name: "Leaf PCM audio",
	extensions: ["w"],
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
			source: "ArcFormats/Leaf/AudioW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafWAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafWAudioDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!hasExtension(sourcePath)) return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasExtension(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf W audio");
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf W audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(PCM_OFFSET),
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
				formatTag: FORMAT_TAG,
				channels: layout.channels,
				sampleRate: layout.sampleRate,
				bitsPerSample: layout.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf W audio");
		const pcm = Buffer.from(
			await source.readAt(BigInt(PCM_OFFSET), layout.dataSize),
		);
		const riff = writeRiffHeader(
			{
				formatTag: FORMAT_TAG,
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
