// Format reference: GARbro ArcFormats/TopCat/ArcTCD1.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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

const SIGNATURE = Buffer.from("TCD1", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET_OFFSET = 8;
const NAMES_OFFSET_OFFSET = 12;
const NAME_MASK = 0x57;

export const tcd1Descriptor: FormatDescriptor = {
	id: "topcat-tcd1",
	name: "TopCat data archive",
	extensions: ["tcd"],
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
			source: "ArcFormats/TopCat/ArcTCD1.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Tcd1Opener.TryOpen`. The offset table scrambles each entry with a shift that depends on
 * its position, while the final offset is stored plainly. Names live in a trailing blob whose
 * non-zero bytes are stored subtracted by 0x57.
 */
async function readTcd1Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(NAMES_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, NAMES_OFFSET_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = header.readUInt32LE(INDEX_OFFSET_OFFSET);
	const namesOffset = header.readUInt32LE(NAMES_OFFSET_OFFSET);
	if (BigInt(namesOffset) >= source.size) return undefined;
	const tableSize = (count + 1) * 4;
	if (BigInt(indexOffset) + BigInt(tableSize) > source.size) return undefined;
	const table = await source.readAt(BigInt(indexOffset), tableSize);
	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const stored = table.readUInt32LE(id * 4);
		const correction = (indexOffset << ((id & 7) + 8)) >>> 0;
		offsets.push(BigInt((stored - correction) >>> 0));
	}
	offsets.push(BigInt(table.readUInt32LE(count * 4)));

	const names = await source.readAt(
		BigInt(namesOffset),
		Number(source.size - BigInt(namesOffset)),
	);
	for (let position = 0; position < names.length; position += 1) {
		const value = names[position] ?? 0;
		if (value !== 0) names[position] = (value - NAME_MASK) & 0xff;
	}
	const entries: FixedEntry[] = [];
	let start = 0;
	for (let position = 0; position < names.length; position += 1) {
		if (names[position] !== 0) continue;
		// GARbro indexes the offset table by name, so more names than records are unsupported.
		if (entries.length >= count) return undefined;
		const name = decodeCp932(names.subarray(start, position));
		start = position + 1;
		const offset = offsets[entries.length] ?? 0n;
		const next = offsets[entries.length + 1] ?? 0n;
		const size = next - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

export const tcd1Format: ArchiveFormat = defineFixedArchive({
	descriptor: tcd1Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTcd1Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readTcd1Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TopCat TCD1 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
