// Format reference: GARBro ArcFormats/Seraphim/ArcArchAngel.cs, class `DatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { decompressArchAngelLz } from "./scn-lz.js";

/** The reference only accepts the engine's fixed file name. */
const FILE_NAME = "archpac.dat";
const COUNT_OFFSET = 0;
const SIZES_OFFSET = 2;
const SIZE_FIELD_SIZE = 4;
const SECTION_ENTRY_SIZE = 6;
const SECTION_OFFSET_SIZE = 4;
const SECTION_INDEX_SIZE = 2;
/** Section tables are small, so the walk reads them in one chunk and refills if needed. */
const SECTION_CHUNK_SIZE = 0x4000;
const DEFAULT_SECTIONS = ["image", "script", ""];
const SCRIPT_TYPE = "script";
/** Script payloads smaller than this are stored as-is. */
const MIN_PACKED_SIZE = 4n;

/**
 * GARBro `DatOpener.TryOpen`. The archive belongs to the ArchAngel engine and only opens when the file
 * is named `ARCHPAC.DAT`. A 16-bit file count sits at offset zero, followed by a table of that many
 * 32-bit sizes. Section records follow the size table as long as they fit before the smallest payload
 * offset seen so far: each is a 32-bit base offset plus a 16-bit starting file index.
 *
 * Entries are then laid out per section in ascending index order. A section walks file indices from
 * its own key until the next section key, creating an entry for every positive size and advancing the
 * base offset by that size; zero sizes are skipped without advancing. Names are
 * `<section>-<index:06>`.
 *
 * Payload types come from the section position: with exactly three sections the reference uses
 * `image`, `script` and an empty type in order, otherwise everything after the first section is an
 * image. Script sections double as the packing flag, and every entry must pass the placement check.
 */
async function readDatIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath ?? "").toLowerCase() !== FILE_NAME) return undefined;
	if (source.size > 0xffffffffn) return undefined;
	if (source.size < BigInt(SIZES_OFFSET)) return undefined;
	const fileCount = (await source.readAt(0n, SIZES_OFFSET)).readInt16LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(fileCount)) return undefined;

	const sizesLength = fileCount * SIZE_FIELD_SIZE;
	if (BigInt(SIZES_OFFSET + sizesLength) > source.size) return undefined;
	const sizes = await source.readAt(BigInt(SIZES_OFFSET), sizesLength);

	// Section records are read until they would cross the smallest payload offset found so far.
	const sections = new Map<number, bigint>();
	let indexPosition = SIZES_OFFSET + sizesLength;
	let minOffset = source.size;
	let cacheStart = indexPosition;
	let cache = await source.readAt(
		BigInt(cacheStart),
		Math.min(SECTION_CHUNK_SIZE, Number(source.size - BigInt(cacheStart))),
	);
	while (BigInt(indexPosition + SECTION_ENTRY_SIZE) <= minOffset) {
		if (indexPosition + SECTION_ENTRY_SIZE > cacheStart + cache.length) {
			cacheStart = indexPosition;
			cache = await source.readAt(
				BigInt(cacheStart),
				Math.min(SECTION_CHUNK_SIZE, Number(source.size - BigInt(cacheStart))),
			);
			if (cache.length < SECTION_ENTRY_SIZE) return undefined;
		}
		const relative = indexPosition - cacheStart;
		const offset = BigInt(cache.readUInt32LE(relative));
		const index = cache.readInt16LE(relative + SECTION_OFFSET_SIZE);
		if (index < 0 || index > fileCount || offset > source.size)
			return undefined;
		if (offset < minOffset) minOffset = offset;
		sections.set(index, offset);
		indexPosition += SECTION_ENTRY_SIZE;
	}

	const entries: FixedEntry[] = [];
	const sectionKeys = [...sections.keys()].sort((left, right) => left - right);
	const useDefaultTypes = sections.size === DEFAULT_SECTIONS.length;
	let sectionNumber = 0;
	for (const key of sectionKeys) {
		let baseOffset = sections.get(key) ?? 0n;
		const type = useDefaultTypes
			? (DEFAULT_SECTIONS[sectionNumber] ?? "")
			: sectionNumber > 0
				? "image"
				: "";
		let fileIndex = key;
		do {
			if (fileIndex < 0) return undefined;
			const sizePosition = BigInt(SIZES_OFFSET + fileIndex * SIZE_FIELD_SIZE);
			if (sizePosition + BigInt(SIZE_FIELD_SIZE) > source.size)
				return undefined;
			// A section key may equal the file count, in which case the reference reads the size
			// straight from the section table region.
			const size =
				fileIndex < fileCount
					? BigInt(sizes.readUInt32LE(fileIndex * SIZE_FIELD_SIZE))
					: BigInt(
							(await source.readAt(sizePosition, SIZE_FIELD_SIZE)).readUInt32LE(
								0,
							),
						);
			if (size > 0n) {
				if (!checkPlacement(baseOffset, size, source.size)) return undefined;
				const entry = createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(
						`${sectionNumber}-${String(fileIndex).padStart(6, "0")}`,
					),
					offset: baseOffset,
					size,
					packedSize: size,
					compressed: type === SCRIPT_TYPE,
					metadata: { type },
				});
				// Script payloads may fall back to their raw extent, so the size stays a hint.
				if (entry.compressed) entry.sizeKnown = false;
				entries.push(entry);
				baseOffset += size;
			}
			fileIndex += 1;
		} while (fileIndex < fileCount && !sections.has(fileIndex));
		sectionNumber += 1;
	}
	// An archive whose section table is empty opens with no entries, as it does in the reference.
	return entries;
}

/**
 * GARBro `DatOpener.OpenEntry`. Script payloads are decoded with the shared ArchAngel LZ decoder; the
 * reference catches every failure there and falls back to the stored range, which the port mirrors.
 * Everything else is emitted verbatim.
 */
const datEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed || entry.packedSize <= MIN_PACKED_SIZE)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	try {
		return Readable.from([decompressArchAngelLz(stored)]);
	} catch {
		return Readable.from([stored]);
	}
};

export const archangelDatDescriptor: FormatDescriptor = {
	id: "archangel-dat",
	name: "ArchAngel engine resource archive",
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
			source: "ArcFormats/Seraphim/ArcArchAngel.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const archangelDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: archangelDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readDatIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDatIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ARCHPAC.DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: datEntryOpener,
});
