// Format reference: GARbro "ArcFormats/Key/AudioOGGPAK.cs", class `OggPakAudio` (a standalone audio
// resource: a fixed header with a length, followed by the embedded Ogg stream).
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
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature gate compares the first four bytes as a little endian word. */
const SIGNATURE = Buffer.from("OGGP", "latin1");
const FULL_SIGNATURE = Buffer.from("OGGPAK", "latin1");
const HEADER_SIZE = 0xf;
/** The embedded stream length lives here, right after the signature. */
const LENGTH_OFFSET = 0xb;

interface Layout {
	offset: number;
	size: number;
}

/** GARbro `OggPakAudio.TryOpen`: the stream starts at the end of the header. */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, FULL_SIGNATURE.length).equals(FULL_SIGNATURE))
			return undefined;
		const length = header.readUInt32LE(LENGTH_OFFSET) >>> 0;
		const size = BigInt(length);
		if (size === 0n) return undefined;
		if (!checkPlacement(BigInt(HEADER_SIZE), size, source.size))
			return undefined;
		return { offset: HEADER_SIZE, size: length };
	} catch {
		return undefined;
	}
}

export const keyOggpakAudioDescriptor: FormatDescriptor = {
	id: "key-oggpak-audio",
	name: "Key audio resource",
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
			source: "ArcFormats/Key/AudioOGGPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const keyOggpakAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: keyOggpakAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Key OGGPAK audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(layout.offset),
				size: BigInt(layout.size),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// Only a trailing region is the payload, so it is shorter than the source.
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
