// Format reference: GARbro "Legacy/BRoom/AudioEZS.cs", class `EzsAudio` (raw PCM behind a header whose wave
// fields are chained back to their real values through a sequence of exclusive or operations). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
} from "../shared/fixed-archive.js";
import { type WavFormat, writeWave } from "../shared/wav.js";

const HEADER_SIZE = 0x1b;
const PCM_SIZE_OFFSET = 0;
const FORMAT_TAG_OFFSET = 5;
const CHANNELS_OFFSET = 7;
const SAMPLE_RATE_OFFSET = 9;
const AVERAGE_BYTES_OFFSET = 13;
const BLOCK_ALIGN_OFFSET = 17;
const BITS_PER_SAMPLE_OFFSET = 19;
const CB_SIZE_OFFSET = 21;
const SUPPORTED_BITS = [8, 16];

interface EzsLayout {
	format: WavFormat;
}

/**
 * The wave fields are not stored as they are. The reference takes a key from the low byte of the field at
 * offset `0x15`, then walks the fields back to their real values, each step using the value the previous one
 * produced, and checks the bit depth and the channel count as it goes. Two details are worth recording: the
 * byte at offset four is read into the key variable and immediately overwritten, so it is never used, and the
 * `DefaultKey` constant the reference declares is commented out of the assignment that would have used it. The
 * port reproduces the chain as written, including the order of the steps and the intermediate values they see.
 */
async function readLayout(source: ByteSource): Promise<EzsLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const pcmSize = header.readUInt32LE(PCM_SIZE_OFFSET);
		if (BigInt(pcmSize) > source.size) return undefined;
		const key = header.readUInt16LE(CB_SIZE_OFFSET) & 0xff;
		const cbSize = (header.readUInt16LE(CB_SIZE_OFFSET) ^ key) & 0xffff;
		const bitsPerSample = header.readUInt16LE(BITS_PER_SAMPLE_OFFSET) ^ key;
		if (!SUPPORTED_BITS.includes(bitsPerSample)) return undefined;
		const averageBytesPerSecond =
			(header.readUInt32LE(AVERAGE_BYTES_OFFSET) ^ cbSize) >>> 0;
		const blockAlign =
			header.readUInt16LE(BLOCK_ALIGN_OFFSET) ^
			(averageBytesPerSecond & 0xffff);
		const channels = header.readUInt16LE(CHANNELS_OFFSET) ^ blockAlign;
		if (channels < 1 || channels > 2) return undefined;
		const sampleRate =
			(header.readUInt32LE(SAMPLE_RATE_OFFSET) ^ channels) >>> 0;
		const formatTag = header.readUInt16LE(FORMAT_TAG_OFFSET) ^ bitsPerSample;
		return {
			format: {
				formatTag,
				channels,
				sampleRate,
				averageBytesPerSecond,
				blockAlign,
				bitsPerSample,
			},
		};
	} catch {
		return undefined;
	}
}

function audioMetadata(format: WavFormat, pcmSize: number) {
	return {
		type: "audio",
		format: "wav",
		formatTag: format.formatTag,
		channels: format.channels,
		sampleRate: format.sampleRate,
		bitsPerSample: format.bitsPerSample,
		pcmSize,
	} as Record<string, unknown>;
}

export const ezsAudioDescriptor: FormatDescriptor = {
	id: "broom-ezs-audio",
	name: "Studio B-Room audio format",
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
			source: "Legacy/BRoom/AudioEZS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ezsAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ezsAudioDescriptor,
	// The reference declares no signature and gates on the `.EZS` extension.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "ezs") return false;
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio B-Room EZS audio",
			);
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const pcmSize = Number(source.size) - HEADER_SIZE;
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				metadata: audioMetadata(layout.format, pcmSize),
			}),
			// The stored payload is raw PCM and the output is a canonical wave file.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: audioMetadata(layout.format, pcmSize),
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio B-Room EZS audio",
			);
		// The reference reads raw PCM from the end of the header to the end of the file; the declared size is
		// only checked, never used as a bound.
		const pcm = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		return Readable.from([writeWave(layout.format, pcm)]);
	},
});
