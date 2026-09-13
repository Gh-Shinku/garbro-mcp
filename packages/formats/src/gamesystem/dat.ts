// Format reference: GARBro ArcFormats/GameSystem/ArcDAT.cs, class `DatOpener` (tag `DAT/0verflow`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** All offsets are sector counts; the index starts after one sector-sized header. */
const SECTOR_SIZE = 0x200n;
const INDEX_OFFSET = 0x400;
const HEADER_SIZE = 4;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 12;
const OFFSET_FIELD = 12;
/** Twelve packed bytes expand into sixteen six-bit characters offset by 0x20. */
const NAME_CHARS = 16;
const CHARACTER_BASE = 0x20;
/** The reference rejects sector counts that are too small or beyond `uint.MaxValue >> 9`. */
const MIN_SECTORS = 2;
const MAX_SECTORS = (0xffffffff >>> 9) - 1;
/** A record whose name field is all ones terminates the index. */
const END_MARKER = 0xff;

export const gamesystemDatDescriptor: FormatDescriptor = {
	id: "gamesystem-dat",
	name: "0verflow resource archive",
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
			source: "ArcFormats/GameSystem/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `DatOpener.RestoreName`. Twelve bytes are read as four big-endian 24-bit values, each
 * producing four six-bit characters based at 0x20. The name ends at the first space inside the first
 * twelve characters, and the extension is the second group of four characters up to its own first
 * space. A leading space is an invalid name and rejects the archive.
 */
export function restoreGamesystemName(field: Buffer): string | undefined {
	const characters = Buffer.alloc(NAME_CHARS);
	for (let source = 0, target = 0; source < NAME_SIZE; source += 3) {
		const word =
			((field[source] ?? 0) << 16) |
			((field[source + 1] ?? 0) << 8) |
			(field[source + 2] ?? 0);
		characters[target] = CHARACTER_BASE + ((word >> 18) & 0x3f);
		characters[target + 1] = CHARACTER_BASE + ((word >> 12) & 0x3f);
		characters[target + 2] = CHARACTER_BASE + ((word >> 6) & 0x3f);
		characters[target + 3] = CHARACTER_BASE + (word & 0x3f);
		target += 4;
	}
	const nameEnd = characters.subarray(0, 12).indexOf(CHARACTER_BASE);
	if (nameEnd === 0) return undefined;
	const name = characters
		.subarray(0, nameEnd === -1 ? 12 : nameEnd)
		.toString("ascii");
	const extensionIndex = characters.subarray(12).indexOf(CHARACTER_BASE);
	if (extensionIndex === 0) return name;
	const extension = characters
		.subarray(12, extensionIndex === -1 ? NAME_CHARS : 12 + extensionIndex)
		.toString("ascii");
	return `${name}.${extension}`;
}

/**
 * GARBro `DatOpener.TryOpen`. The first word counts index sectors, and the doubled sector count must
 * match the first record's payload offset, which is also where the index ends. Records are 0x10 bytes
 * wide: a twelve-byte packed name and a sector offset. The word stored in record `i` is the end of
 * entry `i-1` and the start of entry `i`, so sizes are the distance to the next record's offset, and
 * the index ends when a record's name field is all ones.
 */
async function readGamesystemIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + RECORD_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const sectors = header.readUInt32LE(0);
	if (sectors <= MIN_SECTORS || sectors >= MAX_SECTORS) return undefined;
	const indexSize = BigInt(sectors) * SECTOR_SIZE;
	if (indexSize >= source.size) return undefined;

	let offset = BigInt(
		(await source.readAt(BigInt(INDEX_OFFSET), RECORD_SIZE)).readUInt32LE(
			OFFSET_FIELD,
		),
	);
	offset *= SECTOR_SIZE;
	if (offset !== indexSize) return undefined;

	const entries: FixedEntry[] = [];
	let recordOffset = INDEX_OFFSET;
	let field = (await source.readAt(BigInt(recordOffset), RECORD_SIZE)).subarray(
		0,
		NAME_SIZE,
	);
	while (!field.every((byte) => byte === END_MARKER)) {
		recordOffset += RECORD_SIZE;
		if (BigInt(recordOffset) >= indexSize) return undefined;
		if (recordOffset + RECORD_SIZE > Number(source.size)) return undefined;
		const name = restoreGamesystemName(field);
		if (name === undefined) return undefined;
		const next = await source.readAt(BigInt(recordOffset), RECORD_SIZE);
		const nextOffset = BigInt(next.readUInt32LE(OFFSET_FIELD)) * SECTOR_SIZE;
		if (nextOffset < offset || nextOffset > source.size) return undefined;
		const size = nextOffset - offset;
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size,
			packedSize: size,
			...(name.endsWith(".CRGB") || name.endsWith(".CHAR")
				? { metadata: { type: "image" } }
				: {}),
		});
		entries.push(entry);
		field = next.subarray(0, NAME_SIZE);
		offset = nextOffset;
	}
	return entries.length > 0 ? entries : undefined;
}

export const gamesystemDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gamesystemDatDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGamesystemIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readGamesystemIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid 0verflow DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
