// Format reference: GARbro "ArcFormats/Ethornell/AudioBGI.cs", class `BgiAudio` (a standalone audio
// resource: an offset word and a marker, then the embedded Ogg stream).
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
 * The reference declares the signature list `{ 0x40, 0 }`, so the first four bytes are either the
 * stream offset (`0x40`) or zero.
 */
const HEADER_WORDS = [Buffer.from([0x40, 0, 0, 0]), Buffer.alloc(4)];
const HEADER_SIZE = 8;
const MARKER = Buffer.from("bw  ", "latin1");
const MARKER_OFFSET = 4;

/** GARbro `BgiAudio.TryOpen`: the header names the absolute start of the stream. */
async function readLayout(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		const word = header.subarray(0, 4);
		if (!HEADER_WORDS.some((allowed) => allowed.equals(word))) return undefined;
		if (!header.subarray(MARKER_OFFSET, MARKER_OFFSET + 4).equals(MARKER))
			return undefined;
		const offset = header.readUInt32LE(0) >>> 0;
		if (BigInt(offset) >= source.size) return undefined;
		return offset;
	} catch {
		return undefined;
	}
}

export const bgiAudioDescriptor: FormatDescriptor = {
	id: "ethornell-bw-audio",
	name: "BGI/Ethornell engine audio",
	extensions: ["bw", "", "_bw"],
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
			source: "ArcFormats/Ethornell/AudioBGI.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const bgiAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bgiAudioDescriptor,
	detection: { signatures: HEADER_WORDS.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const offset = await readLayout(source);
		if (offset === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BGI engine audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(offset),
				size: source.size - BigInt(offset),
				metadata: { type: "audio" } as Record<string, unknown>,
			}),
			// The stream runs from the declared offset, so it is shorter unless the offset is zero.
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
