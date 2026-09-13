// Format reference: GARbro "ArcFormats/SysD/AudioDWV.cs", class `DwvAudio` (SYSD engine PCM audio with
// no bit depth field; the reference derives it from the average byte rate). GARbro commit
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

const SIGNATURE = Buffer.from("DW", "ascii");
const HEADER_SIZE = 0x1c;
const LENGTH_OFFSET = 4;
const FORMAT_TAG_OFFSET = 8;
const CHANNELS_OFFSET = 0xa;
const SAMPLE_RATE_OFFSET = 0xc;
const AVERAGE_BYTES_OFFSET = 0x10;
const BLOCK_ALIGN_OFFSET = 0x14;
const PCM_SIZE_OFFSET = 0x18;

interface DwvLayout {
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
 * `DwvAudio.TryOpen`: the header repeats the file length, and the bit depth is not stored at all — the
 * reference divides the average byte rate by the sample rate and the channel count to recover it.
 */
async function readLayout(source: ByteSource): Promise<DwvLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		// The header carries the exact file length.
		if (BigInt(header.readUInt32LE(LENGTH_OFFSET)) !== source.size)
			return undefined;
		const channels = header.readUInt16LE(CHANNELS_OFFSET);
		const sampleRate = header.readUInt32LE(SAMPLE_RATE_OFFSET);
		// The reference would divide by zero here and throw instead of reporting a format.
		if (channels === 0 || sampleRate === 0) return undefined;
		const averageBytesPerSecond = header.readUInt32LE(AVERAGE_BYTES_OFFSET);
		// Integer division at each step, as in the reference's unsigned arithmetic.
		const bitsPerSample = Math.floor(
			(averageBytesPerSecond * 8) / sampleRate / channels,
		);
		const declared = header.readUInt32LE(PCM_SIZE_OFFSET);
		// A region is shortened by the end of the stream rather than rejected.
		const available = Number(source.size) - HEADER_SIZE;
		return {
			formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
			channels,
			sampleRate,
			averageBytesPerSecond,
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample,
			dataOffset: HEADER_SIZE,
			dataSize: Math.min(declared, available),
		};
	} catch {
		return undefined;
	}
}

export const dwvAudioDescriptor: FormatDescriptor = {
	id: "sysd-dwv-audio",
	name: "SYSD engine PCM audio",
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
			source: "ArcFormats/SysD/AudioDWV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dwvAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dwvAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SYSD DWV audio");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SYSD DWV audio");
		const pcm = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
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
