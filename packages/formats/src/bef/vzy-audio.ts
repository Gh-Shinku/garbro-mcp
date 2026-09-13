// Format reference: GARbro "ArcFormats/BeF/AudioVZY.cs", class `VzyAudio` (a wave file whose `RIFF` and
// `WAVEfmt ` markers have been overwritten with zeros). GARbro commit
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

const HEADER_SIZE = 0x12;
/** The first byte of the reconstructed wave header, and the offset the stored payload resumes at. */
const PREFIX_SIZE = 0x10;
const RIFF_LENGTH_OFFSET = 4;
const FORMAT_LENGTH_OFFSET = 0x10;
const FORMAT_BODY_OFFSET = 0x14;
const MIN_FORMAT_LENGTH = 0x10;
const DATA_MARKER = "data";

interface VzyLayout {
	wave: WavLayout;
	pcm: Buffer;
}

/**
 * The file is a wave file with two runs of zeros in place of its markers: bytes zero to three, where `RIFF`
 * belongs, and bytes eight to fifteen, where `WAVE` and `fmt ` belong. The format chunk's length and body are
 * intact, so `TryOpen` rebuilds the sixteen byte prefix and then treats the stored file from offset sixteen
 * onwards as the rest of the wave. The port rebuilds the same bytes and hands them to the shared reader.
 */
async function readLayout(source: ByteSource): Promise<VzyLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		for (let i = 0; i < 4; i += 1) if (header[i] !== 0) return undefined;
		for (let i = 8; i < PREFIX_SIZE; i += 1)
			if (header[i] !== 0) return undefined;
		const riffLength = header.readInt32LE(RIFF_LENGTH_OFFSET);
		// The declared length has to account for the whole file, which also rules out a negative value.
		if (Number(source.size) !== riffLength + 8) return undefined;
		const formatLength = header.readUInt16LE(FORMAT_LENGTH_OFFSET);
		if (formatLength < MIN_FORMAT_LENGTH || formatLength > riffLength)
			return undefined;
		const dataOffset = FORMAT_BODY_OFFSET + formatLength;
		if (source.size < BigInt(dataOffset + 4)) return undefined;
		const stored = Buffer.from(await source.readAt(0n, Number(source.size)));
		// The reference checks the two chunk markers itself, without the word alignment a wave writer would
		// add for an odd sized format chunk.
		if (
			stored.subarray(dataOffset, dataOffset + 4).toString("latin1") !==
			DATA_MARKER
		)
			return undefined;
		const prefix = Buffer.alloc(PREFIX_SIZE);
		prefix.write("RIFF", 0, "latin1");
		// The stored size field is kept as it stands, so the rebuilt header carries the original length.
		stored.copy(prefix, 4, RIFF_LENGTH_OFFSET, 8);
		prefix.write("WAVE", 8, "latin1");
		prefix.write("fmt ", 12, "latin1");
		const rebuilt = Buffer.concat([prefix, stored.subarray(PREFIX_SIZE)]);
		const wave = readWave(rebuilt);
		if (!wave) return undefined;
		const pcm = rebuilt.subarray(
			wave.dataOffset,
			wave.dataOffset + wave.dataSize,
		);
		return { wave, pcm };
	} catch {
		return undefined;
	}
}

function waveMetadata(wave: WavLayout, encrypted: boolean) {
	return {
		type: "audio",
		format: "wav",
		formatTag: wave.format.formatTag,
		channels: wave.format.channels,
		sampleRate: wave.format.sampleRate,
		bitsPerSample: wave.format.bitsPerSample,
		encrypted,
	} as Record<string, unknown>;
}

export const vzyAudioDescriptor: FormatDescriptor = {
	id: "bef-vzy-audio",
	name: "Obfuscated WAVE audio",
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
			source: "ArcFormats/BeF/AudioVZY.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vzyAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vzyAudioDescriptor,
	// The reference declares no signature, and the check it does make is on the zeroed marker bytes.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid obfuscated WAVE audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				encrypted: true,
				metadata: waveMetadata(layout.wave, true),
			}),
			// Extraction writes a canonical wave file, so any chunks beyond the format and data ones drop.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				...waveMetadata(layout.wave, true),
				pcmSize: layout.pcm.length,
			},
		};
	},
	async openEntry(source: ByteSource) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid obfuscated WAVE audio");
		return Readable.from([writeWave(layout.wave.format, layout.pcm)]);
	},
});
