// Format reference: GARbro "Legacy/PineSoft/AudioCMB.cs", class `CmbAudio` (a wave format header behind
// a length-prefixed block). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const HEADER_SIZE = 0x18;
const DATA_SIZE_OFFSET = 0;
const HEADER_SIZE_FIELD_OFFSET = 4;
const FORMAT_TAG_OFFSET = 8;
const CHANNELS_OFFSET = 0xa;
const SAMPLE_RATE_OFFSET = 0xc;
const AVERAGE_BYTES_OFFSET = 0x10;
const BLOCK_ALIGN_OFFSET = 0x14;
const BITS_OFFSET = 0x16;
/** The reference checks the low byte of the format tag rather than the whole word. */
const FORMAT_TAG_LOW_BYTE = 1;
/** Where the reference starts counting its own data offset from, before the stored header size. */
const DATA_BASE = 8;
const MAX_CHANNELS = 2;

interface CmbLayout {
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
 * `CmbAudio.TryOpen`: the two leading lengths must account for the whole file, the low byte of the format
 * tag must be one, and the channel count must be one or two. The payload starts at `8 + header size`.
 */
async function readLayout(source: ByteSource): Promise<CmbLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const dataSize = header.readInt32LE(DATA_SIZE_OFFSET);
		const headerSize = header.readInt32LE(HEADER_SIZE_FIELD_OFFSET);
		// The reference adds these as signed 32 bit values; BigInt keeps a hostile header honest.
		if (
			BigInt(dataSize) + BigInt(headerSize) + BigInt(DATA_BASE) !==
			source.size
		)
			return undefined;
		if (header.readUInt8(FORMAT_TAG_OFFSET) !== FORMAT_TAG_LOW_BYTE)
			return undefined;
		const channels = header.readUInt16LE(CHANNELS_OFFSET);
		if (channels !== 1 && channels !== MAX_CHANNELS) return undefined;
		const dataOffset = DATA_BASE + headerSize;
		// A negative or past the end offset cannot be read, and a negative data size is meaningless.
		if (dataSize < 0 || dataOffset < 0 || BigInt(dataOffset) > source.size)
			return undefined;
		return {
			formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
			channels,
			sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET),
			averageBytesPerSecond: header.readUInt32LE(AVERAGE_BYTES_OFFSET),
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample: header.readUInt16LE(BITS_OFFSET),
			dataOffset,
			dataSize,
		};
	} catch {
		return undefined;
	}
}

export const cmbAudioDescriptor: FormatDescriptor = {
	id: "pinesoft-cmb-audio",
	name: "PineSoft PCM audio",
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
			source: "Legacy/PineSoft/AudioCMB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const cmbAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cmbAudioDescriptor,
	// No signature: the length relation and the tag byte are the whole detection.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PineSoft CMB audio");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PineSoft CMB audio");
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
