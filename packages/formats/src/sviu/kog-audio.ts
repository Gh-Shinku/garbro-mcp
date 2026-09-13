// Format reference: GARbro "ArcFormats/Sviu/AudioKOG.cs", class `KogAudio` (a standalone audio
// resource: a zero signature and a header size, then an Ogg stream).
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

/** The first four bytes must be zero; the reference gates detection on that word. */
const ZERO_SIGNATURE = 0;
/** The header size lives here, as a signed little endian word. */
const SIZE_OFFSET = 4;
const HEADER_SIZE = 8;
const OGG_SIGNATURE = 0x5367674f;

interface Layout {
	offset: number;
	size: number;
}

/**
 * GARbro `KogAudio.TryOpen`: the header size is absolute, and an Ogg page must start there.
 */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (header.readUInt32LE(0) !== ZERO_SIGNATURE) return undefined;
		const headerSize = header.readInt32LE(SIZE_OFFSET);
		if (headerSize <= 0) return undefined;
		const offset64 = BigInt(headerSize);
		if (offset64 + 4n > source.size) return undefined;
		const signature = Buffer.from(await source.readAt(offset64, 4));
		if (signature.readUInt32LE(0) !== OGG_SIGNATURE) return undefined;
		return { offset: headerSize, size: Number(source.size - offset64) };
	} catch {
		return undefined;
	}
}

export const kogAudioDescriptor: FormatDescriptor = {
	id: "sviu-kog-audio",
	name: "SVIU System audio format",
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
			source: "ArcFormats/Sviu/AudioKOG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kogAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kogAudioDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SVIU System KOG audio");
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
