// Format reference: GARbro "ArcFormats/Crowd/AudioEOG.cs", class `EogAudio` (a standalone audio
// resource: an eight byte CRM header followed by an Ogg stream).
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

/** 'CRM' in little endian, with a zero in the fourth byte. */
const SIGNATURE = Buffer.from([0x43, 0x52, 0x4d, 0x00]);
/** The embedded stream starts right after these eight bytes. */
const HEADER_SIZE = 8;

async function readLayout(source: ByteSource): Promise<number | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, 4));
		return header.equals(SIGNATURE) ? HEADER_SIZE : undefined;
	} catch {
		return undefined;
	}
}

export const eogAudioDescriptor: FormatDescriptor = {
	id: "crowd-eog-audio",
	name: "Crowd engine audio format",
	extensions: ["eog", "amb"],
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
			source: "ArcFormats/Crowd/AudioEOG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eogAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eogAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const offset = await readLayout(source);
		if (offset === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Crowd EOG audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(offset),
				size: source.size - BigInt(offset),
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
