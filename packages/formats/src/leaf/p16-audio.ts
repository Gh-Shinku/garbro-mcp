// Format reference: GARbro "ArcFormats/Leaf/AudioP16.cs", class `P16Audio` (a standalone audio
// resource: the whole file is raw sixteen bit mono PCM, which is wrapped in a wave container).
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The reference only opens files with this extension; there is no signature. */
const EXTENSION = "p16";
/** Sixteen bit mono PCM at 44.1 kHz, the format the reference declares for every file. */
const FORMAT = {
	formatTag: 1,
	channels: 1,
	sampleRate: 44100,
	averageBytesPerSecond: 88200,
	blockAlign: 2,
	bitsPerSample: 16,
};

function hasP16Extension(sourcePath: string): boolean {
	return (
		sourceExtension(sourcePath).toLowerCase().replace(/^\./, "") === EXTENSION
	);
}

export const leafP16AudioDescriptor: FormatDescriptor = {
	id: "leaf-p16-audio",
	name: "Leaf PCM audio format",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Leaf/AudioP16.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafP16AudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafP16AudioDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return source.size > 0n && hasP16Extension(sourcePath);
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!hasP16Extension(sourcePath))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf P16 audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "wav"),
				offset: 0n,
				size: source.size,
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// A wave header is prepended, so the payload is longer than the source.
			sizeKnown: false,
		};
		return {
			entries: [entry],
			metadata: {
				audio: "pcm",
				sampleRate: FORMAT.sampleRate,
				channels: FORMAT.channels,
				bitsPerSample: FORMAT.bitsPerSample,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const header = writeRiffHeader(FORMAT, data.length);
		return Readable.from([header, data]);
	},
});
