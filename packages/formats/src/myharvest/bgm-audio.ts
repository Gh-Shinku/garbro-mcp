// Format reference: GARbro "Legacy/Harvest/AudioBGM.cs", class `BgmAudio` (a wave format block with a
// `dar\0` marker followed by raw PCM). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0,
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

const SIGNATURE = Buffer.from("BMG0", "ascii");
const HEADER_SIZE = 0x1c;
const FORMAT_TAG_OFFSET = 4;
const CHANNELS_OFFSET = 6;
const SAMPLE_RATE_OFFSET = 8;
const AVERAGE_BYTES_OFFSET = 0xc;
const BLOCK_ALIGN_OFFSET = 0x10;
const BITS_OFFSET = 0x12;
/** The reference requires this four byte marker, `dar` followed by a NUL. */
const MARKER_OFFSET = 0x14;
const MARKER = Buffer.from([0x64, 0x61, 0x72, 0x00]);
const PCM_SIZE_OFFSET = 0x18;

interface BgmLayout {
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
 * `BgmAudio.TryOpen`: the header holds the wave format, a `dar\0` marker and the PCM length, and the
 * reference checks nothing else — not even the format tag or the channel count.
 */
async function readLayout(source: ByteSource): Promise<BgmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		if (!header.subarray(MARKER_OFFSET, MARKER_OFFSET + 4).equals(MARKER))
			return undefined;
		const declared = header.readUInt32LE(PCM_SIZE_OFFSET);
		// A region is shortened by the end of the stream rather than rejected.
		const available = Number(source.size) - HEADER_SIZE;
		return {
			formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
			channels: header.readUInt16LE(CHANNELS_OFFSET),
			sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET),
			averageBytesPerSecond: header.readUInt32LE(AVERAGE_BYTES_OFFSET),
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample: header.readUInt16LE(BITS_OFFSET),
			dataOffset: HEADER_SIZE,
			dataSize: Math.min(declared, available),
		};
	} catch {
		return undefined;
	}
}

export const harvestBgmAudioDescriptor: FormatDescriptor = {
	id: "myharvest-bgm-audio",
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
			source: "Legacy/Harvest/AudioBGM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const harvestBgmAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: harvestBgmAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest BGM audio");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyHarvest BGM audio");
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
