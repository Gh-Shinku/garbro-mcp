// Format reference: GARbro "ArcFormats/Softpal/AudioBGM.cs", class `BgmAudio` (a standalone audio
// resource: a twelve byte loop timing header followed by an Ogg stream).
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

/** 'BGM ' in little endian. */
const SIGNATURE = Buffer.from("BGM ", "latin1");
const HEADER_SIZE = 0x10;
/** The embedded stream starts here, so its own page signature sits at 0x0C. */
const STREAM_OFFSET = 0xc;
const OGG_SIGNATURE = Buffer.from("OggS", "latin1");

/** GARbro `BgmAudio.TryOpen`: the loop timing header is followed by an Ogg page. */
async function readLayout(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		return header
			.subarray(STREAM_OFFSET, STREAM_OFFSET + 4)
			.equals(OGG_SIGNATURE)
			? STREAM_OFFSET
			: undefined;
	} catch {
		return undefined;
	}
}

export const softpalBgmAudioDescriptor: FormatDescriptor = {
	id: "softpal-bgm-audio",
	name: "Softpal BGM format",
	extensions: ["ogg"],
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
			source: "ArcFormats/Softpal/AudioBGM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const softpalBgmAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: softpalBgmAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const offset = await readLayout(source);
		if (offset === undefined)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Softpal BGM audio");
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
