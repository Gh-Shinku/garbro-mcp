// Format reference: GARbro ArcFormats/Marble/VideoANIM.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const FRAME_TIME_OFFSET = 4;
const FRAME_TIME = 0x21;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 12;
const AUDIO_SIZE_OFFSET = 0x10;
const AUDIO_OFFSET_OFFSET = 0x14;
const TABLE_OFFSET = 0x18;
/** Each frame contributes six bytes to the per-frame metadata block before the tables. */
const FRAME_HEADER_SIZE = 6;
const MAX_DIMENSION = 0x1000;
const FRAME_SUFFIX = ".jpg";
const AUDIO_SUFFIX = "#audio.way";

export const animDescriptor: FormatDescriptor = {
	id: "marble-anim",
	name: "Marble engine video",
	extensions: [""],
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
			source: "ArcFormats/Marble/VideoANIM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface AnimIndex {
	entries: FixedEntry[];
	width: number;
	height: number;
}

/**
 * GARbro `AnimOpener.TryOpen`. The header stores the frame count, the frame duration, the video
 * dimensions, and an optional audio track. Behind a six-byte per-frame block come two tables with
 * one offset and one size per frame. Frames are named `<archive>#<n padded to 5>.jpg` and the audio
 * track, when present, is added as `<archive>#audio.way`.
 */
async function readAnimIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<AnimIndex | undefined> {
	if (source.size < BigInt(TABLE_OFFSET)) return undefined;
	const header = await source.readAt(0n, TABLE_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (header.readInt32LE(FRAME_TIME_OFFSET) !== FRAME_TIME) return undefined;
	const width = header.readInt32LE(WIDTH_OFFSET);
	const height = header.readInt32LE(HEIGHT_OFFSET);
	if (
		width <= 0 ||
		width > MAX_DIMENSION ||
		height <= 0 ||
		height > MAX_DIMENSION
	)
		return undefined;
	const audioSize = BigInt(header.readUInt32LE(AUDIO_SIZE_OFFSET));
	const audioOffset = BigInt(header.readUInt32LE(AUDIO_OFFSET_OFFSET));
	if (audioSize > 0n && !checkPlacement(audioOffset, audioSize, source.size))
		return undefined;

	const tableOffset = BigInt(TABLE_OFFSET + count * FRAME_HEADER_SIZE);
	const tableSize = count * 8;
	if (tableOffset + BigInt(tableSize) > source.size) return undefined;
	const table = await source.readAt(tableOffset, tableSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * 4));
		const size = BigInt(table.readUInt32LE(count * 4 + id * 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(5, "0")}${FRAME_SUFFIX}`,
				),
				offset,
				size,
				metadata: { width, height },
			}),
		);
	}
	if (audioSize > 0n) {
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(`${baseName}${AUDIO_SUFFIX}`),
				offset: audioOffset,
				size: audioSize,
			}),
		);
	}
	return { entries, width, height };
}

export const animFormat: ArchiveFormat = defineFixedArchive({
	descriptor: animDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAnimIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readAnimIndex(source, sourcePath);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Marble ANIM layout");
		return {
			entries: index.entries,
			metadata: {
				entryCount: index.entries.length,
				width: index.width,
				height: index.height,
				frameDurationMs: FRAME_TIME,
			},
		};
	},
});
