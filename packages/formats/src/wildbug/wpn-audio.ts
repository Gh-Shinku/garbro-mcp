// Format reference: GARbro "ArcFormats/WildBug/AudioWPN.cs", class `WpnAudio` (a wave file whose format and
// data chunks are stored at declared offsets instead of following the header). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
import { readWave, type WavLayout, writeWave } from "../shared/wav.js";

/** `WBD` followed by `0x1A`. */
const SIGNATURE = Buffer.from([0x57, 0x42, 0x44, 0x1a]);
const HEADER_SIZE = 0x24;
const WAVE_MARKER_OFFSET = 4;
const VERSION_OFFSET = 8;
/** The reference requires at least this value here. */
const MIN_VERSION = 2;
const FORMAT_OFFSET_OFFSET = 0x10;
const FORMAT_SIZE_OFFSET = 0x14;
const DATA_OFFSET_OFFSET = 0x1c;
const DATA_SIZE_OFFSET = 0x20;
/** The sixteen byte wave prefix the reference builds: `RIFF`, a size, `WAVE` and `fmt `. */
const WAVE_PREFIX = Buffer.from("RIFF\0\0\0\0WAVEfmt ", "latin1");
const MIN_FORMAT_SIZE = 16;

interface WpnLayout {
	wave: WavLayout;
	pcm: Buffer;
}

/**
 * `TryOpen` reads a thirty six byte header that declares where the format chunk and the payload live, then
 * reassembles a wave file around them: the `RIFF`/`WAVE`/`fmt ` prefix, the format chunk body copied from its
 * own offset, and a `data` chunk pointing at the payload. Nothing in the file has to be contiguous, so a test
 * places the two chunks in the opposite order to the header.
 */
async function readLayout(source: ByteSource): Promise<WpnLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		if (header.subarray(WAVE_MARKER_OFFSET, 7).toString("latin1") !== "WAV")
			return undefined;
		if (header.readInt32LE(VERSION_OFFSET) < MIN_VERSION) return undefined;
		const formatOffset = header.readInt32LE(FORMAT_OFFSET_OFFSET);
		const formatSize = header.readInt32LE(FORMAT_SIZE_OFFSET);
		const dataOffset = header.readInt32LE(DATA_OFFSET_OFFSET);
		const dataSize = header.readInt32LE(DATA_SIZE_OFFSET);
		// The reference builds a stream region for each part, which throws when the range does not fit, so a
		// negative or oversized range is declined here rather than clamped.
		const size = Number(source.size);
		if (formatSize < MIN_FORMAT_SIZE) return undefined;
		if (formatOffset < 0 || formatOffset + formatSize > size) return undefined;
		if (dataOffset < 0 || dataOffset + dataSize > size) return undefined;
		const format = Buffer.from(
			await source.readAt(BigInt(formatOffset), formatSize),
		);
		const pcm = Buffer.from(await source.readAt(BigInt(dataOffset), dataSize));
		const prefix = Buffer.from(WAVE_PREFIX);
		const formatSizeField: Buffer = Buffer.alloc(4);
		formatSizeField.writeUInt32LE(formatSize, 0);
		const trailer: Buffer = Buffer.alloc(8);
		trailer.write("data", 0, "latin1");
		trailer.writeUInt32LE(dataSize, 4);
		// Sixteen prefix bytes, the format chunk's size, its body, then the data chunk's marker and size.
		const rebuilt = Buffer.concat([
			prefix,
			formatSizeField,
			format,
			trailer,
			pcm,
		]);
		// The length field describes everything after it, exactly as the reference packs it.
		rebuilt.writeUInt32LE(4 + 8 + formatSize + 8 + dataSize, 4);
		const wave = readWave(rebuilt);
		if (!wave) return undefined;
		return { wave, pcm };
	} catch {
		return undefined;
	}
}

function audioMetadata(wave: WavLayout, pcmSize: number) {
	return {
		type: "audio",
		format: "wav",
		formatTag: wave.format.formatTag,
		channels: wave.format.channels,
		sampleRate: wave.format.sampleRate,
		bitsPerSample: wave.format.bitsPerSample,
		pcmSize,
	} as Record<string, unknown>;
}

export const wpnAudioDescriptor: FormatDescriptor = {
	id: "wildbug-wpn-audio",
	name: "Wild Bug's audio format",
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
			source: "ArcFormats/WildBug/AudioWPN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wpnAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wpnAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Wild Bug WPN audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				metadata: audioMetadata(layout.wave, layout.pcm.length),
			}),
			// Extraction writes a canonical wave file, so only the two referenced chunks survive.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: audioMetadata(layout.wave, layout.pcm.length),
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Wild Bug WPN audio");
		return Readable.from([writeWave(layout.wave.format, layout.pcm)]);
	},
});
