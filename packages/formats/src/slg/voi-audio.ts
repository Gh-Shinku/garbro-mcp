// Format reference: GARbro "ArcFormats/Slg/AudioVOI.cs", class `VoiAudio` (a standalone audio
// resource: a small header names the offset of the embedded Ogg stream).
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

/** The header byte that holds the distance to the stream. */
const OFFSET_FIELD = 0x1e;
/** The stream starts this far after the offset byte. */
const STREAM_BASE = 0x20;
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");

interface Layout {
	offset: number;
	size: number;
}

/** GARbro `VoiAudio.TryOpen`: read the offset, then require an Ogg page there. */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size <= BigInt(STREAM_BASE)) return undefined;
	try {
		const field = Buffer.from(await source.readAt(BigInt(OFFSET_FIELD), 1));
		const offset = field[0] ?? 0;
		if (offset <= 0) return undefined;
		const offset64 = BigInt(STREAM_BASE + offset);
		if (offset64 + 4n > source.size) return undefined;
		const signature = Buffer.from(await source.readAt(offset64, 4));
		if (!signature.equals(OGG_SIGNATURE)) return undefined;
		return { offset: Number(offset64), size: Number(source.size - offset64) };
	} catch {
		return undefined;
	}
}

export const voiAudioDescriptor: FormatDescriptor = {
	id: "slg-voi-audio",
	name: "SLG system obfuscated Ogg audio",
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
			source: "ArcFormats/Slg/AudioVOI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const voiAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: voiAudioDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SLG system VOI audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(layout.offset),
				size: BigInt(layout.size),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The stream is the tail of the file, so it is shorter than the source.
			sizeKnown: false,
		};
		return { entries: [entry], metadata: { audio: "ogg" } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([data]);
	},
});
