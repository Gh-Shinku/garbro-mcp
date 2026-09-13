// Format reference: GARbro "ArcFormats/TamaSoft/AudioESD.cs", class `EsdAudio` (a standalone audio
// resource: a wave format header followed by raw PCM, which is wrapped in a wave container).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** 'ESD ' in little endian. */
const SIGNATURE = Buffer.from("ESD ", "latin1");
const HEADER_SIZE = 0x20;
/** The format fields the reference reads out of the header. */
const SAMPLE_RATE_OFFSET = 8;
const BITS_OFFSET = 0xc;
const CHANNELS_OFFSET = 0x10;

interface EsdFormat {
	channels: number;
	sampleRate: number;
	bitsPerSample: number;
}

interface Layout {
	format: EsdFormat;
}

/** GARbro `EsdAudio.TryOpen`, which derives a PCM format from the header. */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const channels = header.readUInt16LE(CHANNELS_OFFSET);
		const sampleRate = header.readUInt32LE(SAMPLE_RATE_OFFSET) >>> 0;
		const bitsPerSample = header.readUInt16LE(BITS_OFFSET);
		// The reference trusts these fields; the port requires them to describe real PCM.
		if (channels === 0 || sampleRate === 0) return undefined;
		if (bitsPerSample === 0 || bitsPerSample % 8 !== 0) return undefined;
		return { format: { channels, sampleRate, bitsPerSample } };
	} catch {
		return undefined;
	}
}

function waveFormat(format: EsdFormat) {
	const blockAlign = (format.channels * format.bitsPerSample) / 8;
	return {
		formatTag: 1,
		channels: format.channels,
		sampleRate: format.sampleRate,
		averageBytesPerSecond: format.sampleRate * blockAlign,
		blockAlign,
		bitsPerSample: format.bitsPerSample,
	};
}

export const esdAudioDescriptor: FormatDescriptor = {
	id: "tamasoft-esd-audio",
	name: "TamaSoft ADV system audio",
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
			source: "ArcFormats/TamaSoft/AudioESD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const esdAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: esdAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft ESD audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: BigInt(HEADER_SIZE),
				size: source.size - BigInt(HEADER_SIZE),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// A wave header is prepended, so the payload is longer than the stored region.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "pcm",
				sampleRate: layout.format.sampleRate,
				channels: layout.format.channels,
				bitsPerSample: layout.format.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TamaSoft ESD audio");
		return Readable.from([
			writeRiffHeader(waveFormat(layout.format), data.length),
			data,
		]);
	},
});
