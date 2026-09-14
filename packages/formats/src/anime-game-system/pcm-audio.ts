// Format reference: GARbro "ArcFormats/AnimeGameSystem/AudioPCM.cs", classes `PcmAudio` and `PcmInput`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { writeRiffHeader } from "../kapp/asd.js";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/**
 * The reference finds its files by a word with one **nibble of its last byte masked off**, so the word is the
 * three letters `WAV` and the fourth byte is the kind of sound, as long as it is below ten. The type is read
 * out of the file again rather than from the word.
 */
const MASK = 0xf0ffffff;
const SIGNATURE = 0x00564157;
const HEADER_SIZE = 4;
const TYPE_FIELD = 3;
/** The kind of sound the reference knows, by its type byte with the channel bit taken off. */
const PCM_FORMATS = new Map<
	number,
	{ sampleRate: number; bitsPerSample: number }
>([
	[0x0a, { sampleRate: 44100, bitsPerSample: 16 }],
	[0x06, { sampleRate: 22050, bitsPerSample: 16 }],
	[0x04, { sampleRate: 22050, bitsPerSample: 8 }],
]);
const FORMAT_TAG = 1;
/** The one bit of the type byte that counts the channels, one more than it says. */
const CHANNEL_BIT = 1;

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

interface PcmLayout {
	channels: number;
	sampleRate: number;
	bitsPerSample: number;
}

/**
 * The reference takes the kind of sound from the fourth byte: its low bit says how many channels there are one
 * more of, and the rest of it names a rate and a depth. A kind it does not know makes its reader **throw** —
 * and GARbro's own dispatch catches whatever a reader throws while the format is being found, keeps the error
 * and moves on to the next one, so such a file is no more this format's than one whose word is another's.
 */
async function readLayout(source: ByteSource): Promise<PcmLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.length < HEADER_SIZE) return undefined;
		if ((header.readUInt32LE(0) & MASK) >>> 0 !== SIGNATURE) return undefined;
		const type = header[TYPE_FIELD] ?? 0;
		const kind = PCM_FORMATS.get(type & ~CHANNEL_BIT);
		if (!kind) return undefined;
		return { ...kind, channels: (type & CHANNEL_BIT) + 1 };
	} catch {
		return undefined;
	}
}

function waveFormat(layout: PcmLayout) {
	const blockAlign = (layout.channels * layout.bitsPerSample) / 8;
	return {
		formatTag: FORMAT_TAG,
		channels: layout.channels,
		sampleRate: layout.sampleRate,
		bitsPerSample: layout.bitsPerSample,
		blockAlign,
		averageBytesPerSecond: layout.sampleRate * blockAlign,
	};
}

export const agsPcmAudioDescriptor: FormatDescriptor = {
	id: "ags-pcm-audio",
	name: "AnimeGameSystem PCM audio",
	extensions: ["pcm"],
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
			source: "ArcFormats/AnimeGameSystem/AudioPCM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const agsPcmAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: agsPcmAudioDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x57, 0x41, 0x56, 0x00]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid AnimeGameSystem PCM audio",
			);
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(leafName(sourcePath), "wav"),
				// The four bytes of the word are not part of the sound.
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				compressed: false,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// A wave header is prepended, so the payload is longer than the source.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "pcm",
				sampleRate: layout.sampleRate,
				channels: layout.channels,
				bitsPerSample: layout.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid AnimeGameSystem PCM audio",
			);
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const header = writeRiffHeader(waveFormat(layout), data.length);
		return Readable.from([header, data]);
	},
});
