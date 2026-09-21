// Format reference: GARBro "ArcFormats/WildBug/AudioWWA.cs", class `WwaAudio` with the `WwaReader` beside
// it, which stands on the `WpxDecoder` of "ArcFormats/WildBug/ImageWBM.cs". GARbro commit
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
import type { WavFormat } from "../shared/wav.js";
import {
	findWpxSection,
	readWpxIndex,
	readWpxSectionData,
	WPX_SIGNATURE,
	type WpxSection,
} from "./wpx-section.js";

/** The four bytes that tell a sound of this engine from a picture of it. */
const WAVE_MARKER = "WAV";
/** The record that keeps the format of the sound, and the one that keeps its samples. */
const FORMAT_SECTION_ID = 0x20;
const DATA_SECTION_ID = 0x21;
/** The way the samples are stored, which the sound always asks for. */
const UNCOMPRESSED_FORMAT = 0x80;
/** The smallest format block a sound carries: the six fields of a plain wave format. */
const MIN_FORMAT_SIZE = 0x10;
/** The head of a wave file, which the reference writes itself around the format block it copies. */
const WAVE_HEADER_TAIL = 20;
const DATA_BLOCK_HEADER = 8;
const FORMAT_BLOCK_TAG = "fmt ";
const DATA_BLOCK_TAG = "data";

export interface WwaLayout {
	format: WavFormat;
	/** The format block as the file keeps it, which is copied into the wave file as it stands. */
	formatBlock: Buffer;
	pcm: Buffer;
}

function invalid(): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", "Invalid Wild Bug WWA audio");
}

/** The six fields of a plain wave format block. */
function readFormatBlock(block: Buffer): WavFormat | undefined {
	if (block.length < MIN_FORMAT_SIZE) return undefined;
	return {
		formatTag: block.readUInt16LE(0),
		channels: block.readUInt16LE(2),
		sampleRate: block.readUInt32LE(4),
		averageBytesPerSecond: block.readUInt32LE(8),
		blockAlign: block.readUInt16LE(12),
		bitsPerSample: block.readUInt16LE(14),
	};
}

/**
 * `WwaAudio.TryOpen`: the head names a sound, and the directory behind it keeps a format block and the
 * samples. The reference asks that the format block is stored with the one way a sound of this engine knows,
 * refuses the file otherwise, and reads the samples **as they stand**.
 *
 * The reference reads the samples at whatever place its stream has reached - the end of the format block -
 * rather than at the place the sample record names. Those two places are the same for every file whose
 * records stand one behind the other, which is every file the reference can read, but a file that keeps
 * them apart reads differently here: this port takes the record's own place.
 */
export function readWwaLayout(data: Buffer): WwaLayout | undefined {
	const index = readWpxIndex(data, WAVE_MARKER);
	if (!index) return undefined;
	const formatSection: WpxSection | undefined = findWpxSection(
		index.directory,
		FORMAT_SECTION_ID,
		index.count,
		index.directorySize,
	);
	if (
		!formatSection ||
		formatSection.unpackedSize < MIN_FORMAT_SIZE ||
		formatSection.dataFormat !== UNCOMPRESSED_FORMAT
	) {
		return undefined;
	}
	const formatBlock = readWpxSectionData(
		data,
		formatSection,
		formatSection.unpackedSize,
	);
	if (!formatBlock) return undefined;
	const format = readFormatBlock(formatBlock);
	if (!format) return undefined;
	const dataSection = findWpxSection(
		index.directory,
		DATA_SECTION_ID,
		index.count,
		index.directorySize,
	);
	if (!dataSection) return undefined;
	// The reader of this engine hands the samples over as they stand for the way it insists on.
	const pcm = readWpxSectionData(data, dataSection, dataSection.unpackedSize);
	if (!pcm) return undefined;
	return { format, formatBlock, pcm };
}

/** The wave file the reference wraps the samples in: its own head, and the format block as it stands. */
export function writeWwaWave(layout: WwaLayout): Buffer {
	const total =
		WAVE_HEADER_TAIL + layout.formatBlock.length + layout.pcm.length;
	const head = Buffer.alloc(WAVE_HEADER_TAIL + layout.formatBlock.length, 0x00);
	head.write("RIFF", 0, "latin1");
	head.writeUInt32LE(total, 4);
	head.write("WAVE", 8, "latin1");
	head.write(FORMAT_BLOCK_TAG, 12, "latin1");
	head.writeUInt32LE(layout.formatBlock.length, 16);
	layout.formatBlock.copy(head, 20);
	const tail = Buffer.alloc(DATA_BLOCK_HEADER, 0x00);
	tail.write(DATA_BLOCK_TAG, 0, "latin1");
	tail.writeUInt32LE(layout.pcm.length, 4);
	return Buffer.concat([head, tail, layout.pcm]);
}

function audioMetadata(layout: WwaLayout): Record<string, unknown> {
	return {
		type: "audio",
		format: "wav",
		formatTag: layout.format.formatTag,
		channels: layout.format.channels,
		sampleRate: layout.format.sampleRate,
		bitsPerSample: layout.format.bitsPerSample,
		pcmSize: layout.pcm.length,
	};
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const wildbugWwaAudioDescriptor: FormatDescriptor = {
	id: "wildbug-wwa-audio",
	name: "Wild Bug compressed audio",
	extensions: [".wwa"],
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
			source: "ArcFormats/WildBug/AudioWWA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wildbugWwaAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wildbugWwaAudioDescriptor,
	// A picture of this engine opens with the same word, so the four bytes behind it are the difference.
	detection: { signatures: [{ bytes: WPX_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < 0x10n) return false;
		return readWwaLayout(await readStored(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const stored = await readStored(source);
		const layout = readWwaLayout(stored);
		if (!layout) throw invalid();
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				compressed: false,
				metadata: audioMetadata(layout),
			}),
			// Extraction writes a wave file around the samples, which is not the length of the file.
			sizeKnown: false,
		};
		return { entries: [entry], metadata: audioMetadata(layout) };
	},
	async openEntry(source: ByteSource, _entry, _sourcePath) {
		const stored = await readStored(source);
		const layout = readWwaLayout(stored);
		if (!layout) throw invalid();
		return Readable.from([writeWwaWave(layout)]);
	},
});
