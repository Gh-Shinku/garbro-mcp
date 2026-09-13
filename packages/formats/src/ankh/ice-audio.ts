// Format reference: GARbro "ArcFormats/Ankh/AudioPCM.cs", class `IceAudio` (Ice Soft PCM audio).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
} from "../shared/fixed-archive.js";
import { writeWave, type WavFormat } from "../shared/wav.js";

/**
 * The two registered signatures, each three bytes: a wave format tag of one in the first two, then the
 * version byte, which is the only thing that tells them apart.
 */
const SIGNATURES = [
	Buffer.from([0x01, 0x00, 0x01]),
	Buffer.from([0x01, 0x00, 0x02]),
];
/** A wave `fmt ` payload, its extra size word and the data size. */
const HEADER_SIZE = 0x16;
const DATA_OFFSET = HEADER_SIZE;
const MAX_PCM_SIZE = 256 * 1024 * 1024;

interface IceLayout {
	format: WavFormat;
	pcmSize: number;
}

/**
 * `TryOpen` reads twenty two bytes and reads a wave's `fmt ` payload straight out of them: the format tag, the
 * channel count, both rates, the block alignment and the bit depth, then an extra size that has to be zero and
 * the size of the data that follows. There are no RIFF markers anywhere — the file holds the `fmt ` chunk's
 * contents and the data size, and nothing else.
 *
 * Two details are worth naming. The reference requires the announced size to account for the whole file, so a
 * trailing byte is a rejectable difference. And it checks the byte rate by multiplying in **thirty two bit**
 * arithmetic, so the product wraps; a port that multiplied with wider numbers would reject files the reference
 * accepts. A test uses a rate of 0x80000000 and a block alignment of three, whose product wraps back to
 * 0x80000000 and matches.
 */
async function readFields(source: ByteSource): Promise<IceLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		// The dispatcher gates on the three byte signatures; a direct call to `detect` does not, so the
		// version byte is checked here. The first two bytes are the format tag, checked just below.
		const version = head[2];
		const versionKnown = SIGNATURES.some((bytes) => bytes[2] === version);
		if (!versionKnown) return undefined;
		const formatTag = head.readUInt16LE(0);
		if (formatTag !== 1) return undefined;
		const pcmSize = head.readUInt32LE(0x12);
		if (BigInt(pcmSize) + BigInt(HEADER_SIZE) !== source.size) return undefined;
		if (pcmSize > MAX_PCM_SIZE) return undefined;
		if (head.readUInt16LE(0x10) !== 0) return undefined;
		const channels = head.readUInt16LE(2);
		if (channels !== 1 && channels !== 2) return undefined;
		const sampleRate = head.readUInt32LE(4);
		const averageBytesPerSecond = head.readUInt32LE(8);
		const blockAlign = head.readUInt16LE(0xc);
		const bitsPerSample = head.readUInt16LE(0xe);
		if (averageBytesPerSecond === 0) return undefined;
		// Thirty two bit arithmetic, wrapping exactly as the reference's `uint` multiply does.
		if ((sampleRate * blockAlign) >>> 0 !== averageBytesPerSecond)
			return undefined;
		return {
			pcmSize,
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

export const iceAudioDescriptor: FormatDescriptor = {
	id: "ankh-ice-audio",
	name: "Ice Soft PCM audio",
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
			source: "ArcFormats/Ankh/AudioPCM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const iceAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: iceAudioDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice PCM audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(layout.pcmSize),
				compressed: false,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The extraction wraps the pcm in a wave container, so it is longer than the entry.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				channels: layout.format.channels,
				sampleRate: layout.format.sampleRate,
				bitsPerSample: layout.format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ice PCM audio");
		const pcm = Buffer.from(
			await source.readAt(BigInt(DATA_OFFSET), layout.pcmSize),
		);
		// The reference hands out a raw PCM stream; a wave container around it is what an extraction wants,
		// and the format's own header supplies every field of it.
		return Readable.from([writeWave(layout.format, pcm)]);
	},
});
