// Format reference: GARbro "ArcFormats/Eushully/AudioAOG.cs", class `AogAudio` (a standalone audio
// resource: the container header is skipped and the embedded Ogg stream is the payload).
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

const SIGNATURE = Buffer.from("AOGG", "latin1");
const HEADER_SIZE = 0x18;
/** The embedded stream starts here and must be a plain Ogg page. */
const OGG_OFFSET = 0x14;
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");

async function hasOggStream(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(HEADER_SIZE)) return false;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return false;
		return header.subarray(OGG_OFFSET, OGG_OFFSET + 4).equals(OGG_SIGNATURE);
	} catch {
		return false;
	}
}

export const eushullyAogAudioDescriptor: FormatDescriptor = {
	id: "eushully-aog-audio",
	name: "System3 engine audio format",
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
			source: "ArcFormats/Eushully/AudioAOG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const eushullyAogAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: eushullyAogAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return hasOggStream(source);
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!(await hasOggStream(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid System3 AOG audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(OGG_OFFSET),
				size: source.size - BigInt(OGG_OFFSET),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The container header is dropped, so the payload is shorter than the source.
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
