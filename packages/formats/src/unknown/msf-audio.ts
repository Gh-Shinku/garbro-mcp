// Format reference: GARbro "Legacy/Unknown/AudioMSF.cs", class `MsfAudio` (a scrambled wave format
// header followed by raw PCM). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const SIGNATURE = Buffer.from("MSF ", "ascii");
/** The reference reads this many bytes and scrambles all of them. */
const HEADER_SIZE = 0x30;
/** The scramble key is derived from this word of the **stored** header. */
const KEY_WORD_OFFSET = 4;
const KEY_MULTIPLIER = 101;
const KEY_ADDEND = 778;
/** Fields of the descrambled header. */
const PCM_SIZE_OFFSET = 0x18;
const FORMAT_TAG_OFFSET = 0x1c;
const CHANNELS_OFFSET = 0x1e;
const SAMPLE_RATE_OFFSET = 0x20;
const AVERAGE_BYTES_OFFSET = 0x24;
const BLOCK_ALIGN_OFFSET = 0x28;
const BITS_OFFSET = 0x2a;

interface MsfLayout {
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
 * `MsfAudio.TryOpen`: the key is `101 * <stored word at 4> + 778` truncated to sixteen bits, and every
 * two byte pair of the header is XORed with it little endian, key byte first.
 */
function descramble(header: Buffer, key: number): Buffer {
	const output = Buffer.from(header);
	for (let i = 0; i < output.length; i += 2) {
		output[i] = (output[i] as number) ^ (key & 0xff);
		output[i + 1] = (output[i + 1] as number) ^ ((key >> 8) & 0xff);
	}
	return output;
}

async function readLayout(source: ByteSource): Promise<MsfLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!stored.subarray(0, SIGNATURE.length).equals(SIGNATURE))
			return undefined;
		// The key comes from the scrambled word, so it is read before any XOR.
		const key =
			(KEY_MULTIPLIER * stored.readUInt16LE(KEY_WORD_OFFSET) + KEY_ADDEND) &
			0xffff;
		const header = descramble(stored, key);
		const declared = header.readUInt32LE(PCM_SIZE_OFFSET);
		// GARbro's `StreamRegion` clamps at the end of the stream, so a short payload is shortened
		// rather than rejected.
		const available = Number(source.size) - HEADER_SIZE;
		const dataSize = Math.min(declared, available);
		return {
			formatTag: header.readUInt16LE(FORMAT_TAG_OFFSET),
			channels: header.readUInt16LE(CHANNELS_OFFSET),
			sampleRate: header.readUInt32LE(SAMPLE_RATE_OFFSET),
			averageBytesPerSecond: header.readUInt32LE(AVERAGE_BYTES_OFFSET),
			blockAlign: header.readUInt16LE(BLOCK_ALIGN_OFFSET),
			bitsPerSample: header.readUInt16LE(BITS_OFFSET),
			dataOffset: HEADER_SIZE,
			dataSize,
		};
	} catch {
		return undefined;
	}
}

export const msfAudioDescriptor: FormatDescriptor = {
	id: "unknown-msf-audio",
	name: "'Unknown' PCM audio format",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		// The wave format header is scrambled; the PCM itself is plain.
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Unknown/AudioMSF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const msfAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: msfAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid MSF audio");
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
				scrambledHeader: true,
				formatTag: layout.formatTag,
				channels: layout.channels,
				sampleRate: layout.sampleRate,
				bitsPerSample: layout.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout) throw new GarbroError("INVALID_ARCHIVE", "Invalid MSF audio");
		const pcm = Buffer.from(
			await source.readAt(BigInt(layout.dataOffset), layout.dataSize),
		);
		// The whole wave format block comes from the descrambled header and is copied verbatim.
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
