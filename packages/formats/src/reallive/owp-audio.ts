// Format reference: GARbro "ArcFormats/RealLive/AudioOWP.cs", class `OwpAudio` (a standalone audio
// resource: the whole file is an Ogg stream masked with a single byte key).
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

/** The reference masks the stream with this key; `'OggS' ^ 0x39` is the declared signature. */
const KEY = 0x39;
const SIGNATURE = Buffer.from([0x76, 0x5e, 0x5e, 0x6a]);

async function hasSignature(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(SIGNATURE.length)) return false;
	try {
		const header = Buffer.from(await source.readAt(0n, SIGNATURE.length));
		return header.equals(SIGNATURE);
	} catch {
		return false;
	}
}

export const realliveOwpAudioDescriptor: FormatDescriptor = {
	id: "reallive-owp-audio",
	name: "RealLive engine obfuscated OGG audio",
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
			source: "ArcFormats/RealLive/AudioOWP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const realliveOwpAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: realliveOwpAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return hasSignature(source);
	},
	async read(source: ByteSource, sourcePath: string) {
		if (!(await hasSignature(source)))
			throw new GarbroError("INVALID_ARCHIVE", "Invalid RealLive OWP audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = createFixedEntry({
			id: 0,
			path: changeExtension(fileName, "ogg"),
			offset: 0n,
			size: source.size,
			encrypted: true,
			metadata: { type: "audio" } as Record<string, unknown>,
		});
		return { entries: [entry], metadata: { audio: "ogg", key: KEY } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const output: Buffer = Buffer.alloc(data.length);
		for (let i = 0; i < data.length; i += 1) output[i] = (data[i] ?? 0) ^ KEY;
		return Readable.from([output]);
	},
});
