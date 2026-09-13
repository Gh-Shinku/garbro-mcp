// Format reference: GARbro "ArcFormats/MicroVision/AudioIKM.cs", class `IkmAudio` (a standalone
// audio resource: a fixed header with a length, followed by the embedded Ogg stream).
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

/** 'IKM' in little endian, with a zero in the fourth byte. */
const SIGNATURE = Buffer.from([0x49, 0x4b, 0x4d, 0x00]);
const HEADER_SIZE = 0x40;
/** The embedded stream length lives here. */
const LENGTH_OFFSET = 0x24;

interface Layout {
	offset: number;
	size: number;
}

/**
 * GARbro `IkmAudio.TryOpen`: the embedded stream is the last `length` bytes of the file, so its
 * offset is derived from the file size rather than stored.
 */
async function readLayout(source: ByteSource): Promise<Layout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	try {
		const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
		if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
		const length = header.readUInt32LE(LENGTH_OFFSET) >>> 0;
		if (length === 0 || BigInt(length) > source.size) return undefined;
		return { offset: Number(source.size - BigInt(length)), size: length };
	} catch {
		return undefined;
	}
}

export const ikmAudioDescriptor: FormatDescriptor = {
	id: "microvision-ikm-audio",
	name: "MicroVision audio format",
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
			source: "ArcFormats/MicroVision/AudioIKM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ikmAudioFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ikmAudioDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLayout(source)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MicroVision IKM audio");
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
