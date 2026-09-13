// Format reference: GARBro ArcFormats/Seraphim/ArcVoice.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

/** GARbro accepts only these file names for this format. */
const FILE_PATTERN = /^voice(?:\d|pac)\.dat$/i;
const COUNT_OFFSET = 0;
const COUNT_SIZE = 2;
const V1_INDEX_OFFSET = 2;
const V1_RECORD_SIZE = 4;
const V2_INDEX_OFFSET = 6;
const V2_RECORD_SIZE = 12;
const V2_SIZE_OFFSET = 4;

export const voiceDescriptor: FormatDescriptor = {
	id: "seraphim-voice",
	name: "Seraphim engine resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Seraphim/ArcVoice.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `VoiceDatOpener.TryOpen`. Only files named `Voice<digit>.dat` or `Voicepac.dat` qualify.
 * A 16-bit record count at 0 is followed by two layouts, chosen by whether the word at 2 looks like
 * a data offset: the first variant chains offsets and names entries `*.wav`, while the second stores
 * offset and size pairs per record and names entries `*.ogg`.
 */
async function readVoiceIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (!FILE_PATTERN.test(basename(sourcePath))) return undefined;
	if (source.size < BigInt(COUNT_SIZE)) return undefined;
	const header = await source.readAt(0n, COUNT_SIZE + 4);
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const dataOffset = BigInt(COUNT_SIZE + V1_RECORD_SIZE * count);
	const nextOffset = BigInt(header.readUInt32LE(V1_INDEX_OFFSET));
	if (nextOffset < dataOffset || nextOffset >= source.size)
		return await readV2(source, count);
	return await readV1(source, count, nextOffset);
}

/** GARBro `ReadV1`: a chain of offsets where every entry runs up to the next one. */
async function readV1(
	source: ByteSource,
	count: number,
	firstOffset: bigint,
): Promise<FixedEntry[] | undefined> {
	const entries: FixedEntry[] = [];
	let offset = firstOffset;
	for (let id = 0; id < count; id += 1) {
		const next =
			id + 1 === count
				? source.size
				: BigInt(
						(
							await source.readAt(
								BigInt(V1_INDEX_OFFSET + V1_RECORD_SIZE * (id + 1)),
								4,
							)
						).readUInt32LE(0),
					);
		const size = next - offset;
		if (size <= 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${String(id).padStart(5, "0")}.wav`),
				offset,
				size,
			}),
		);
		offset = next;
	}
	return entries;
}

/** GARBro `ReadV2`: 12-byte records with an offset and a size. */
async function readV2(
	source: ByteSource,
	count: number,
): Promise<FixedEntry[] | undefined> {
	const indexSize = count * V2_RECORD_SIZE;
	if (BigInt(V2_INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(V2_INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * V2_RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + V2_SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${String(id).padStart(5, "0")}.ogg`),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const voiceFormat: ArchiveFormat = defineFixedArchive({
	descriptor: voiceDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readVoiceIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readVoiceIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Seraphim voice layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
