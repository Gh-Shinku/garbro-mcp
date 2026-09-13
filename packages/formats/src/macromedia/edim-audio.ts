// Format reference: GARbro "ArcFormats/Macromedia/AudioEDIM.cs", class `EdimAudio` (a standalone
// audio resource: a big endian offset in the header, then an MP3 stream).
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

/**
 * The reference declares the signature list `{ 0x40010000, 0x64010000 }` but reads the word as big
 * endian, so the stored bytes are these two patterns.
 */
const SIGNATURES = [
	Buffer.from([0x00, 0x00, 0x01, 0x40]),
	Buffer.from([0x00, 0x00, 0x01, 0x64]),
];
const HEADER_SIZE = 4;

/** GARbro `EdimAudio.TryOpen`: the stream starts four bytes after the header word. */
async function readLayout(source: ByteSource): Promise<number | undefined> {
	if (source.size <= BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!SIGNATURES.some((allowed) => allowed.equals(header))) return undefined;
		const offset = HEADER_SIZE + header.readUInt32BE(0);
		// The reference does not check the offset; the port requires it to leave a stream.
		if (BigInt(offset) >= source.size) return undefined;
		return offset;
	} catch {
		return undefined;
	}
}

export const edimAudioDescriptor: FormatDescriptor = {
	id: "macromedia-edim-audio",
	name: "Macromedia Director audio format",
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
			source: "ArcFormats/Macromedia/AudioEDIM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const edimAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: edimAudioDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const offset = await readLayout(source);
		if (offset === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Macromedia EDIM audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "mp3"),
				offset: BigInt(offset),
				size: source.size - BigInt(offset),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The stream is the tail of the file, so it is shorter than the source.
			sizeKnown: false,
		};
		return { entries: [entry], metadata: { audio: "mp3" } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		return Readable.from([data]);
	},
});
