// Format reference: GARBro ArcFormats/Lilim/ArcAOS.cs, class `AosOpener`.
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
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { openPackedHuffmanEntry } from "./packed.js";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
/** The first record pointer must be aligned to the record size. */
const RECORD_ALIGNMENT = 0x1f;
/** A name field filled with this byte continues the index instead of naming an entry. */
const LINK_BYTE = 0xff;
/** Payloads start with the unpacked size, then the Huffman stream. */
const PACKED_HEADER_SIZE = 4;
/** Entries with this extension hold a Huffman stream. */
const PACKED_EXTENSION = "scr";
/** Bounds the walk so a damaged index cannot spin or allocate without limit. */
const MAX_RECORDS = 0x100000;

export const aosDescriptor: FormatDescriptor = {
	id: "lilim-aos",
	name: "LiLiM/Le.Chocolat engine resource archive",
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
			source: "ArcFormats/Lilim/ArcAOS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isLinkField(field: Buffer): boolean {
	for (const byte of field) if (byte !== LINK_BYTE) return false;
	return true;
}

/**
 * GARBro `AosOpener.TryOpen`. The index is a linked list of 0x20-byte records. A name field filled
 * with `0xFF` is a link whose offset word is added to the position after that record, a name field
 * starting with a zero ends the index, and anything else names an entry with an offset at 0x10 and a
 * size at 0x14.
 *
 * The first record pointer lives at 0x10, must be aligned to the record size, and must point at a link
 * or end field. GARbro compares each name with the previous one and rejects a repeat, so consecutive
 * duplicates never reach the directory.
 *
 * The reference performs no placement check while reading the index. Because AOS has neither a
 * signature nor an extension to detect it by, the port adds that check as a documented hardening so a
 * damaged index cannot be mistaken for this format. Entries named `*.scr` hold a Huffman stream whose
 * output size is bounded by the word in front of it.
 */
async function readAosIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const head = await source.readAt(0n, INDEX_OFFSET + 4);
	if ((head[0] ?? 0) === 0) return undefined;
	const firstOffset = BigInt(head.readUInt32LE(INDEX_OFFSET));
	if (firstOffset >= source.size) return undefined;
	if ((firstOffset & BigInt(RECORD_ALIGNMENT)) !== 0n) return undefined;
	// GARbro compares the field with `SequenceEqual`, which a short read always fails.
	if (firstOffset + BigInt(NAME_SIZE) > source.size) return undefined;
	const firstField = await source.readAt(firstOffset, NAME_SIZE);
	if (!isLinkField(firstField) && (firstField[0] ?? 1) !== 0) return undefined;

	const entries: FixedEntry[] = [];
	let previousName: string | undefined;
	let currentOffset = 0n;
	for (let record = 0; record < MAX_RECORDS; record += 1) {
		if (currentOffset < 0n || currentOffset >= source.size) break;
		if (currentOffset + BigInt(NAME_SIZE) > source.size) break;
		const field = await source.readAt(currentOffset, NAME_SIZE);
		if (isLinkField(field)) {
			const next = BigInt(
				(
					await source.readAt(currentOffset + BigInt(OFFSET_FIELD), 4)
				).readUInt32LE(0),
			);
			currentOffset += BigInt(RECORD_SIZE) + next;
			continue;
		}
		if ((field[0] ?? 0) === 0) break;
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0 || name.trim().length === 0) return undefined;
		if (previousName === name) return undefined;
		previousName = name;

		const offset = BigInt(
			(
				await source.readAt(currentOffset + BigInt(OFFSET_FIELD), 4)
			).readUInt32LE(0),
		);
		const storedSize = BigInt(
			(await source.readAt(currentOffset + BigInt(SIZE_FIELD), 4)).readUInt32LE(
				0,
			),
		);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed = sourceExtension(name) === PACKED_EXTENSION;
		let size = storedSize;
		if (
			packed &&
			storedSize >= BigInt(PACKED_HEADER_SIZE) &&
			offset + BigInt(PACKED_HEADER_SIZE) <= source.size
		) {
			size = BigInt(
				(await source.readAt(offset, PACKED_HEADER_SIZE)).readUInt32LE(0),
			);
		}
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size,
			packedSize: storedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
		currentOffset += BigInt(RECORD_SIZE);
	}
	return entries;
}

export const aosFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aosDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAosIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAosIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AOS index layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openPackedHuffmanEntry,
});
