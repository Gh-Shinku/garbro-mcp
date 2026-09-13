// Format reference: GARBro ArcFormats/Triangle/ArcCGF.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const OFFSET1_OFFSET = 0x14;
const OFFSET2_OFFSET = 0x20;
const HEADER_SIZE = 0x24;
/** Entry offsets carry two flag bits in their top bits. */
const OFFSET_MASK = 0x3fffffff;
const FLAG_SHIFT = 30;
/** GARbro refuses archives at or beyond this size. */
const MAX_ARCHIVE_SIZE = 0x3fffffffn;
const NAME_FIELD_TAIL = 4;
const OFFSET_FIELD_TAIL = 4;
const ENTRY_SIZES = [0x14, 0x20] as const;
/** Flags value that selects the prefixed payload layout. */
const PREFIXED_FLAGS = 2;
/** Bytes read ahead of a prefixed payload. */
const PREFIX_OFFSET = 0x10;
/** Size word, four data bytes, then the payload follow the prefix. */
const PREFIX_HEADER_SIZE = 12;
const PACKED_SIZE_HEADER_SIZE = 8;

export const cgfDescriptor: FormatDescriptor = {
	id: "triangle-cgf",
	name: "route2 engine CG archive",
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
			source: "ArcFormats/Triangle/ArcCGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `CgfOpener.TryOpen`. The record count at 0 selects one of two record widths: the width whose
 * implied index end matches the entry offset field at 0x14 (for 0x14-byte records) or at 0x20 (for
 * 0x20-byte records). Each record holds a name and, in its last word, the next entry's offset with two
 * flag bits in the top bits; the last record's follower is the file size.
 *
 * GARbro rejects layouts whose first entry spans exactly the first two offsets, which distinguishes
 * route2 archives from the sibling variants, and the port exposes the two flag bits as metadata.
 */
async function readCgfIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	if (source.size >= MAX_ARCHIVE_SIZE) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const offset1 = header.readUInt32LE(OFFSET1_OFFSET);
	const offset2 = header.readUInt32LE(OFFSET2_OFFSET);

	let entrySize: number | undefined;
	let next = 0;
	for (const candidate of ENTRY_SIZES) {
		const expected = (INDEX_OFFSET + count * candidate) >>> 0;
		if (
			expected ===
			((candidate === ENTRY_SIZES[0] ? offset1 : offset2) & OFFSET_MASK)
		) {
			entrySize = candidate;
			next = candidate === ENTRY_SIZES[0] ? offset1 : offset2;
			break;
		}
	}
	if (entrySize === undefined) return undefined;
	const indexSize = entrySize * count;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	// GARbro compares the first record's trailing word with the span between the second record's
	// trailing word and the first offset, and reads that second word from the file even when the
	// index holds a single record. The trailing word of record `i` holds entry `i`'s start offset.
	const firstSize = index.readUInt32LE(
		entrySize - NAME_FIELD_TAIL - OFFSET_FIELD_TAIL,
	);
	if (BigInt(INDEX_OFFSET + entrySize * 2) <= source.size) {
		const secondFollow = (
			await source.readAt(
				BigInt(INDEX_OFFSET + entrySize * 2 - OFFSET_FIELD_TAIL),
				OFFSET_FIELD_TAIL,
			)
		).readUInt32LE(0);
		if (firstSize === (secondFollow - next) >>> 0) return undefined;
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * entrySize;
		const nameField = index.subarray(
			record,
			record + entrySize - OFFSET_FIELD_TAIL,
		);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(next & OFFSET_MASK);
		const flags = next >>> FLAG_SHIFT;
		const follower =
			id + 1 === count
				? source.size
				: BigInt(
						index.readUInt32LE(record + entrySize * 2 - OFFSET_FIELD_TAIL),
					);
		if (follower < offset) return undefined;
		const size = BigInt(Number(follower) & OFFSET_MASK) - offset;
		if (size < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
		});
		// GARbro only tracks flags for entries it wraps in `CgfEntry`; `1` and `.iaf` entries keep
		// the plain layout and are read raw.
		const wrapped = flags !== 1 && !name.toLowerCase().endsWith(".iaf");
		// Extraction emits a synthetic header in front of the payload, so the stored span and the
		// extracted length differ.
		entry.sizeKnown = false;
		if (wrapped) entry.metadata = { flags };
		entries.push(entry);
		next = Number(follower);
	}
	return entries;
}

/**
 * GARBro `CgfOpener.OpenEntry`. Every entry GARbro wraps in `CgfEntry` is read as a twelve-byte
 * header followed by the payload. The size word and four header bytes sit in front of the payload;
 * an entry flagged with `2` first skips sixteen bytes and also keeps the record's first eight bytes.
 */
async function openCgfEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const flags =
		typeof entry.metadata?.flags === "number"
			? entry.metadata.flags
			: undefined;
	if (flags === undefined)
		return source.createReadStream(entry.offset, entry.size);
	const header = Buffer.alloc(PREFIX_HEADER_SIZE);
	let base = entry.offset;
	if (flags === PREFIXED_FLAGS) {
		(await source.readAt(base, PACKED_SIZE_HEADER_SIZE)).copy(header, 0);
		base += BigInt(PREFIX_OFFSET);
	}
	const packedSize = BigInt((await source.readAt(base, 4)).readUInt32LE(0));
	(await source.readAt(base + 4n, 4)).copy(header, PACKED_SIZE_HEADER_SIZE);
	const payload = source.createReadStream(base + 8n, packedSize);
	return Readable.from(
		(async function* () {
			yield header;
			for await (const chunk of payload) yield chunk as Buffer;
		})(),
	);
}

export const cgfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cgfDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCgfIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCgfIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid route2 CGF layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openCgfEntry,
});
