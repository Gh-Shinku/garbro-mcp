// Format reference: GARbro "ArcFormats/Kid/AudioWAF.cs", class `WafAudio` (KID ADPCM audio file).
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

/** `'WAF'`, three bytes. */
const SIGNATURE = Buffer.from([0x57, 0x41, 0x46]);
/** The reference reads this much and then treats the rest of the file as the codec stream. */
const HEADER_SIZE = 0x38;
/** Microsoft ADPCM. */
const FORMAT_TAG = 2;
/** The codec's own data, thirty two bytes of coefficients, which is the `fmt ` extra size as well. */
const CODEC_DATA_OFFSET = 0x14;
const CODEC_DATA_SIZE = 0x20;
/** The declared size of the codec stream. */
const DATA_SIZE_OFFSET = 0x34;
/** A wave header the reference writes by hand: `fmt ` names fifty bytes, sixteen plus the extra size plus two. */
const FMT_SIZE = 0x32;
const WAVE_HEADER_SIZE = 78;
/** The size word of the wave, which is everything after it. */
const RIFF_SIZE_BASE = WAVE_HEADER_SIZE - 8;

interface WafLayout {
	channels: number;
	sampleRate: number;
	averageBytesPerSecond: number;
	blockAlign: number;
	bitsPerSample: number;
	codecData: Buffer;
	dataSize: number;
}

/**
 * The reference performs no validation at all beyond the signature: it copies six fields out of a fifty six
 * byte header, lays the thirty two bytes of Microsoft ADPCM coefficients after them and writes a wave header
 * whose `data` size is the word at 0x34. The port keeps that shape — the `data` size is reported as declared
 * even when the file holds fewer bytes, and the stream that follows is everything to the end of the file, which
 * is what a region over the rest of the stream is.
 */
async function readFields(source: ByteSource): Promise<WafLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
		return {
			channels: head.readUInt16LE(6),
			sampleRate: head.readUInt32LE(8),
			averageBytesPerSecond: head.readUInt32LE(0xc),
			blockAlign: head.readUInt16LE(0x10),
			bitsPerSample: head.readUInt16LE(0x12),
			codecData: Buffer.from(
				head.subarray(CODEC_DATA_OFFSET, CODEC_DATA_OFFSET + CODEC_DATA_SIZE),
			),
			dataSize: head.readInt32LE(DATA_SIZE_OFFSET),
		};
	} catch {
		return undefined;
	}
}

/** The wave the reference assembles in memory, byte for byte. */
function buildWave(layout: WafLayout, stream: Buffer): Buffer {
	const header: Buffer = Buffer.alloc(WAVE_HEADER_SIZE, 0x00);
	header.write("RIFF", 0, "latin1");
	header.writeUInt32LE(RIFF_SIZE_BASE + layout.dataSize, 4);
	header.write("WAVE", 8, "latin1");
	header.write("fmt ", 12, "latin1");
	header.writeUInt32LE(FMT_SIZE, 16);
	header.writeUInt16LE(FORMAT_TAG, 20);
	header.writeUInt16LE(layout.channels, 22);
	header.writeUInt32LE(layout.sampleRate, 24);
	header.writeUInt32LE(layout.averageBytesPerSecond, 28);
	header.writeUInt16LE(layout.blockAlign, 32);
	header.writeUInt16LE(layout.bitsPerSample, 34);
	header.writeUInt16LE(CODEC_DATA_SIZE, 36);
	layout.codecData.copy(header, 38);
	header.write("data", 70, "latin1");
	header.writeUInt32LE(layout.dataSize, 74);
	return Buffer.concat([header, stream]);
}

export const wafAudioDescriptor: FormatDescriptor = {
	id: "kid-waf-audio",
	name: "KID ADPCM audio",
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
			source: "ArcFormats/Kid/AudioWAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wafAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wafAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFields(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KID WAF audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: BigInt(Math.max(layout.dataSize, 0)),
				compressed: false,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The extraction gains a wave header, so it is not the stored length.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "wav",
				formatTag: FORMAT_TAG,
				channels: layout.channels,
				sampleRate: layout.sampleRate,
				blockAlign: layout.blockAlign,
				bitsPerSample: layout.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readFields(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KID WAF audio");
		// A region over the rest of the stream, whatever the declared size says, so trailing bytes come along.
		const stream = Buffer.from(
			await source.readAt(
				BigInt(HEADER_SIZE),
				Number(source.size) - HEADER_SIZE,
			),
		);
		return Readable.from([buildWave(layout, stream)]);
	},
});
