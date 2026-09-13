// Format reference: GARbro "ArcFormats/ShiinaRio/AudioOGV.cs", class `OgvAudio` (a standalone audio
// resource: a RIFF-like chunk walk that ends at an embedded Ogg stream).
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

/** 'OGV' in little endian, with a zero in the fourth byte. */
const SIGNATURE = Buffer.from([0x4f, 0x47, 0x56, 0x00]);
/** The `fmt ` chunk header the reference reads here. */
const FMT_OFFSET = 0xc;
const CHUNK_HEADER_SIZE = 8;
const FMT_ID = Buffer.from("fmt ", "latin1");
const DATA_ID = Buffer.from("data", "latin1");

interface Layout {
	offset: number;
}

/**
 * GARbro `OgvAudio.TryOpen`: an eight byte `fmt ` chunk at `0x0C` holds a relative offset, and the
 * `data` chunk header that follows it ends right before the stream.
 */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	try {
		const fmt = Buffer.from(
			await source.readAt(BigInt(FMT_OFFSET), CHUNK_HEADER_SIZE),
		);
		if (!fmt.subarray(0, 4).equals(FMT_ID)) return undefined;
		const distance = fmt.readUInt32LE(4) >>> 0;
		// The reference seeks relative to the position after the fmt chunk.
		const dataOffset =
			BigInt(FMT_OFFSET + CHUNK_HEADER_SIZE) + BigInt(distance);
		const data = Buffer.from(
			await source.readAt(dataOffset, CHUNK_HEADER_SIZE),
		);
		if (!data.subarray(0, 4).equals(DATA_ID)) return undefined;
		const streamOffset = Number(dataOffset) + CHUNK_HEADER_SIZE;
		if (BigInt(streamOffset) > source.size) return undefined;
		return { offset: streamOffset };
	} catch {
		return undefined;
	}
}

export const ogvAudioDescriptor: FormatDescriptor = {
	id: "shiina-rio-ogv-audio",
	name: "ShiinaRio audio format",
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
			source: "ArcFormats/ShiinaRio/AudioOGV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ogvAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ogvAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ShiinaRio OGV audio");
		const fileName = sourcePath.replace(/^.*[/\\]/, "");
		const entry: FixedEntry = {
			...createFixedEntry({
				id: 0,
				path: changeExtension(fileName, "ogg"),
				offset: BigInt(layout.offset),
				size: source.size - BigInt(layout.offset),
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
