// Format reference: GARbro "Legacy/Artel/AudioMUW.cs", class `MuwAudio` (the ADVG engine's wave file,
// which carries an eight character `PCMWFMT ` tag instead of `WAVEfmt `). GARbro commit
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

const SIGNATURE = Buffer.from("RIFF", "ascii");
const HEADER_SIZE = 0x24;
/** The tag where a wave file would have `WAVEfmt `. */
const FORMAT_TAG = Buffer.from("PCMWFMT ", "latin1");
const FORMAT_TAG_OFFSET = 8;
/** The offset added to the distance field to reach the `data` chunk. */
const DATA_BASE = 0x14;
const DISTANCE_OFFSET = 0x10;
const FORMAT_OFFSET = 0x14;
const DATA_TAG = 0x61746164;

interface MuwLayout {
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
 * `MuwAudio.TryOpen`: a `RIFF` file with a `PCMWFMT ` tag, a distance to the `data` chunk in the header
 * and the wave format fields immediately after it.
 */
async function readLayout(source: ByteSource): Promise<MuwLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (
			!header.subarray(0, SIGNATURE.length).equals(SIGNATURE) ||
			!header
				.subarray(FORMAT_TAG_OFFSET, FORMAT_TAG_OFFSET + FORMAT_TAG.length)
				.equals(FORMAT_TAG)
		)
			return undefined;
		const dataPos = header.readUInt32LE(DISTANCE_OFFSET) + DATA_BASE;
		if (BigInt(dataPos + 8) > source.size) return undefined;
		const chunk = Buffer.from(await source.readAt(BigInt(dataPos), 8));
		if (chunk.readUInt32LE(0) !== DATA_TAG) return undefined;
		const declared = chunk.readUInt32LE(4);
		// A region is shortened by the end of the stream rather than rejected.
		const available = Number(source.size) - (dataPos + 8);
		return {
			formatTag: header.readUInt16LE(FORMAT_OFFSET),
			channels: header.readUInt16LE(FORMAT_OFFSET + 2),
			sampleRate: header.readUInt32LE(FORMAT_OFFSET + 4),
			averageBytesPerSecond: header.readUInt32LE(FORMAT_OFFSET + 8),
			blockAlign: header.readUInt16LE(FORMAT_OFFSET + 12),
			bitsPerSample: header.readUInt16LE(FORMAT_OFFSET + 14),
			dataOffset: dataPos + 8,
			dataSize: Math.min(declared, available),
		};
	} catch {
		return undefined;
	}
}

export const muwAudioDescriptor: FormatDescriptor = {
	id: "artel-muw-audio",
	name: "Artel ADVG engine audio file",
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
			source: "Legacy/Artel/AudioMUW.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const muwAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: muwAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Artel MUW audio");
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
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Artel MUW audio");
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
