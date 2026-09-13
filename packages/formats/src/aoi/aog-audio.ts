// Format reference: GARbro "ArcFormats/Aoi/AudioAOG.cs", class `AogAudio` (a standalone audio
// resource: an AoiOgg header that names the offset of the embedded Ogg stream in one of two ways).
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

const SIGNATURE = Buffer.from("AoiO", "latin1");
const FULL_SIGNATURE = Buffer.from("AoiOgg", "latin1");
const DECODE_SIGNATURE = Buffer.from("Decode", "latin1");
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");
/** The reference reads this many header bytes before it decides. */
const HEADER_SIZE = 0x3c;
/** The plain layout: the stream starts here. */
const PLAIN_OFFSET = 0x2c;
/** The decoded layout: the marker sits at 0x0C and the stream starts here. */
const DECODE_MARKER_OFFSET = 0x0c;
const DECODE_OFFSET = 0x38;

/** GARbro `AogAudio.TryOpen`, which accepts exactly two header shapes. */
async function readLayout(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, FULL_SIGNATURE.length).equals(FULL_SIGNATURE))
			return undefined;
		if (header.subarray(PLAIN_OFFSET, PLAIN_OFFSET + 4).equals(OGG_SIGNATURE))
			return PLAIN_OFFSET;
		const isDecoded =
			header
				.subarray(DECODE_MARKER_OFFSET, DECODE_MARKER_OFFSET + 6)
				.equals(DECODE_SIGNATURE) &&
			header.subarray(DECODE_OFFSET, DECODE_OFFSET + 4).equals(OGG_SIGNATURE);
		return isDecoded ? DECODE_OFFSET : undefined;
	} catch {
		return undefined;
	}
}

export const aoiAogAudioDescriptor: FormatDescriptor = {
	id: "aoi-aog-audio",
	name: "Aoi engine audio format",
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
			source: "ArcFormats/Aoi/AudioAOG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const aoiAogAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aoiAogAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const offset = await readLayout(source);
		if (offset === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Aoi engine AOG audio");
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
