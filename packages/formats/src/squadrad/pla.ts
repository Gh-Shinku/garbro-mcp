// Format reference: GARBro Legacy/SquadraD/ArcPLA.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = 0x2e616c50;
const ARC_SIZE_OFFSET = 4;
const CHECK_OFFSET = 8;
const MARKER_OFFSET = 0x10;
const MARKER = 2;
const COUNT_OFFSET = 0x0e;
const INDEX_OFFSET = 0x14;
const PARAMETER_SIZE = 16;
const OFFSET_SIZE = 4;
const SAMPLE_SIZE = 4;
const LOW_MASK = 0xd5555555;
const HIGH_MASK = 0xaaaaaaaa;

export const plaDescriptor: FormatDescriptor = {
	id: "squadrad-pla",
	name: "Squadra D audio archive",
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
			source: "Legacy/SquadraD/ArcPLA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PlaOpener.TryOpen`. The header repeats the file size at 4, stores a bit-rotation check
 * word at 8, the value 2 at 0x10, and a 16-bit record count at 0x0e. The index follows at 0x14 as
 * four parallel tables: record ids, per-record audio parameters (one of them the channel count),
 * data offsets, and per-record sample data.
 *
 * Sizes are derived backwards from the end of the file, so every entry runs up to the next recorded
 * offset.
 */
async function readPlaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	const arcSize = header.readUInt32LE(ARC_SIZE_OFFSET);
	if (BigInt(arcSize) !== source.size) return undefined;
	if (header.readUInt32LE(MARKER_OFFSET) !== MARKER) return undefined;
	const expected = (((arcSize & LOW_MASK) << 1) | (arcSize & HIGH_MASK)) >>> 0;
	if (expected !== header.readUInt32LE(CHECK_OFFSET)) return undefined;
	const count = header.readUInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	let position = INDEX_OFFSET;
	const readFields = async (length: number): Promise<Buffer | undefined> => {
		if (BigInt(position + length) > source.size) return undefined;
		const buffer = await source.readAt(BigInt(position), length);
		position += length;
		return buffer;
	};

	const ids = await readFields(count * 4);
	if (!ids) return undefined;
	const parameters = await readFields(count * PARAMETER_SIZE);
	if (!parameters) return undefined;
	const offsets = await readFields(count * OFFSET_SIZE);
	if (!offsets) return undefined;

	const metadatas: { sampleRate: number; channels: number }[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * PARAMETER_SIZE;
		metadatas.push({
			sampleRate: parameters.readUInt32LE(record + 4),
			channels: parameters.readInt32LE(record + 8),
		});
	}
	let sampleCount = 0;
	for (const metadata of metadatas) {
		if (metadata.channels <= 0) return undefined;
		sampleCount += metadata.channels * 2;
	}
	if (!(await readFields(sampleCount * SAMPLE_SIZE))) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(String(ids.readInt32LE(id * 4)).padStart(5, "0")),
				offset: BigInt(offsets.readUInt32LE(id * 4)),
				size: 0n,
			}),
		);
	}
	let next = source.size;
	for (let id = entries.length - 1; id >= 0; id -= 1) {
		const entry = entries[id];
		if (!entry) continue;
		const size = next - entry.offset;
		if (size < 0n || !checkPlacement(entry.offset, size, source.size))
			return undefined;
		entry.size = size;
		entry.packedSize = size;
		entry.metadata = { ...metadatas[id] };
		next = entry.offset;
	}
	return entries;
}

export const plaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: plaDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x50, 0x6c, 0x61, 0x2e]) }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPlaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPlaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Squadra D PLA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
