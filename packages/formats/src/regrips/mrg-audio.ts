// Format reference: GARbro "Legacy/Regrips/AudioWRG.cs", class `MrgAudio` (an MP3 whose bytes are
// inverted). GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Readable } from "node:stream";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { GarbroError } from "@garbro-mcp/core";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SCRAMBLE_KEY = 0xff;

function descramble(input: Buffer): Buffer {
	const output = Buffer.from(input);
	for (let i = 0; i < output.length; i += 1)
		output[i] = (output[i] ?? 0) ^ SCRAMBLE_KEY;
	return output;
}

interface MpegFrame {
	length: number;
	version: number;
	sampleRate: number;
}

const MPEG1_LAYER3_BITRATES = [
	0, 32, 40, 48, 56, 64, 80, 96, 112, 128, 160, 192, 224, 256, 320,
];
const MPEG2_LAYER3_BITRATES = [
	0, 8, 16, 24, 32, 40, 48, 56, 64, 80, 96, 112, 128, 144, 160,
];
const MPEG1_SAMPLE_RATES = [44100, 48000, 32000];

function readMpegLayer3Frame(
	buffer: Buffer,
	offset: number,
): MpegFrame | undefined {
	if (offset < 0 || offset + 4 > buffer.length) return undefined;
	const header = buffer.readUInt32BE(offset);
	if (header >>> 21 !== 0x7ff) return undefined;
	const version = (header >>> 19) & 3;
	const layer = (header >>> 17) & 3;
	const bitrateIndex = (header >>> 12) & 0xf;
	const sampleRateIndex = (header >>> 10) & 3;
	if (
		version === 1 ||
		layer !== 1 ||
		bitrateIndex === 0 ||
		bitrateIndex === 0xf ||
		sampleRateIndex === 3
	)
		return undefined;
	const bitrate = (
		version === 3 ? MPEG1_LAYER3_BITRATES : MPEG2_LAYER3_BITRATES
	)[bitrateIndex];
	const baseSampleRate = MPEG1_SAMPLE_RATES[sampleRateIndex];
	if (bitrate === undefined || baseSampleRate === undefined) return undefined;
	const sampleRate =
		version === 3 ? baseSampleRate : baseSampleRate / (version === 2 ? 2 : 4);
	const padding = (header >>> 9) & 1;
	const length =
		Math.floor(((version === 3 ? 144000 : 72000) * bitrate) / sampleRate) +
		padding;
	if (length < 4 || offset + length > buffer.length) return undefined;
	return { length, version, sampleRate };
}

/** Requires two structurally compatible MPEG Layer III frames at their calculated boundaries. */
function looksLikeMp3(buffer: Buffer): boolean {
	const first = readMpegLayer3Frame(buffer, 0);
	if (!first) return false;
	const second = readMpegLayer3Frame(buffer, first.length);
	return (
		second !== undefined &&
		second.version === first.version &&
		second.sampleRate === first.sampleRate
	);
}

/**
 * `MrgAudio.TryOpen` reads two bytes and rejects the file unless the first is zero, then inverts the whole
 * stream and hands it to the MP3 format. The zero is a proxy for the inverted frame header: exclusive-oring
 * zero with `0xFF` gives the `0xFF` that begins an MPEG frame, so the check reads the stored byte rather
 * than the decoded one.
 */
async function readAudio(source: ByteSource): Promise<Buffer | undefined> {
	if (source.size < 2n) return undefined;
	try {
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		if (stored[0] !== 0) return undefined;
		const decoded = descramble(stored);
		if (!looksLikeMp3(decoded)) return undefined;
		return decoded;
	} catch {
		return undefined;
	}
}

export const regripsMrgAudioDescriptor: FormatDescriptor = {
	id: "regrips-mrg-audio",
	name: "Regrips encrypted MP3 file",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Regrips/AudioWRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const regripsMrgAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: regripsMrgAudioDescriptor,
	// The reference declares no signature, so the format is a candidate for every file.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAudio(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const decoded = await readAudio(source);
		if (!decoded)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips MRG audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "mp3"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// Inverting bytes preserves length, so the listed size is the extracted size.
			sizeKnown: true,
		};
		return {
			entries: [entry],
			metadata: { audio: "mp3", encrypted: true },
		};
	},
	async openEntry(source: ByteSource) {
		const decoded = await readAudio(source);
		if (!decoded)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Regrips MRG audio");
		// The reference hands the decoded stream to the MP3 reader, so the output is those bytes.
		return Readable.from([decoded]);
	},
});
