// Format reference: GARbro "Legacy/Harvest/AudioSED.cs", class `SedAudio` (a raw PCM resource with a
// complete wave format block in its header). GARbro commit
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
} from "../shared/fixed-archive.js";

/** 'S','E', a version byte and a zero; `0x14553` as a little endian word. */
const SIGNATURE = Buffer.from([0x53, 0x45, 0x01, 0x00]);
const HEADER_SIZE = 0x18;
const FORMAT_TAG_OFFSET = 2;
const CHANNELS_OFFSET = 4;
const SAMPLE_RATE_OFFSET = 6;
const AVERAGE_BYTES_OFFSET = 0xa;
const BLOCK_ALIGN_OFFSET = 0xe;
const BITS_OFFSET = 0x10;
/** The two word marker the reference requires before the payload length. */
const DATA_MARKER_OFFSET = 0x12;
const DATA_MARKER = Buffer.from("da", "ascii");
const DATA_SIZE_OFFSET = 0x14;

interface SedLayout {
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
 * GARbro `SedAudio.TryOpen`: `SE` at the start, a complete wave format block, the `da` marker and the
 * payload length, which the reference uses as the region size instead of reading to the end.
 */
async function readLayout(source: ByteSource): Promise<SedLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		if (
			!header
				.subarray(DATA_MARKER_OFFSET, DATA_MARKER_OFFSET + 2)
				.equals(DATA_MARKER)
		)
			return undefined;
		const channels = header.readUInt16LE(CHANNELS_OFFSET);
		const bitsPerSample = header.readUInt16LE(BITS_OFFSET);
		// A zero here would make the header meaningless; the reference passes it on unchecked.
		if (channels === 0 || bitsPerSample === 0) return undefined;
		const dataSize = header.readUInt32LE(DATA_SIZE_OFFSET);
		// The reference builds a region of this length and fails outside the file.
		if (BigInt(HEADER_SIZE) + BigInt(dataSize) > source.size) return undefined;
		return {
			formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
			channels,
			sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET),
			averageBytesPerSecond: header.readUInt32LE(AVERAGE_BYTES_OFFSET),
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample,
			dataOffset: HEADER_SIZE,
			dataSize,
		};
	} catch {
		return undefined;
	}
}

export const sedAudioDescriptor: FormatDescriptor = {
	id: "myharvest-sed-audio",
	name: "MyHarvest audio resource",
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
			source: "Legacy/Harvest/AudioSED.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sedAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sedAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest SED audio");
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
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest SED audio");
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
