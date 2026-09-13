// Format reference: GARBro ArcFormats/Software House Parsley/ArcCG2.cs
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
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const FILE_NAME = "cg";
/** The payload area starts behind a fixed 0x6000-byte index region. */
const DATA_OFFSET = 0x6000;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
const OFFSET_OFFSET = 0x20;
const WIDTH_OFFSET = 0x24;
const HEIGHT_OFFSET = 0x28;
const SIZE_OFFSET = 0x2c;
const BPP = 8;

export const cgV2Descriptor: FormatDescriptor = {
	id: "parsley-cg2",
	name: "Software House Parsley CG archive",
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
			source: "ArcFormats/Software House Parsley/ArcCG2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `CgV2Opener.TryOpen`. The archive is a file named `CG` with a 0x6000-byte index region: a
 * chain of 0x30-byte records that stops at the first zero byte. Each record holds a 0x20-byte name,
 * a data offset relative to the payload area, the image width and height, and the stored size.
 */
async function readCg2Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath).toLowerCase() !== FILE_NAME) return undefined;
	if (source.size <= BigInt(DATA_OFFSET)) return undefined;
	const index = await source.readAt(0n, DATA_OFFSET);
	const entries: FixedEntry[] = [];
	for (
		let position = 0;
		position + RECORD_SIZE <= index.length;
		position += RECORD_SIZE
	) {
		if ((index[position] ?? 0) === 0) break;
		const name = decodeCStringField(index, position, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const offset =
			BigInt(index.readUInt32LE(position + OFFSET_OFFSET)) +
			BigInt(DATA_OFFSET);
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size,
		});
		entry.metadata = {
			width: index.readUInt32LE(position + WIDTH_OFFSET),
			height: index.readUInt32LE(position + HEIGHT_OFFSET),
			bpp: BPP,
		};
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const cgV2Format: ArchiveFormat = defineFixedArchive({
	descriptor: cgV2Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCg2Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCg2Index(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Software House Parsley CG layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
