// Format reference: GARBro Legacy/ShapeShifter/ArcBND.cs, class `BndOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const FIRST_OFFSET = 4;
const INDEX_START = 4;
const RECORD_SIZE = 12;
const UNPACKED_SIZE_OFFSET = 4;
const STORED_SIZE_OFFSET = 8;
const NAME_WIDTH = 4;
const BMP_SIGNATURE = 0x4d42;
/** A stored payload may carry a one-byte prefix in front of the marker. */
const PREFIXED_BMP_SIGNATURE = 0x4d4207;
const PREFIXED_BMP_MASK = 0xffff07;
/** The archive name decides the type of every entry, unless it names none. */
const DEFAULT_TYPES: readonly { name: string; type: string }[] = [
	{ name: "SCR", type: "script" },
	{ name: "VOICE", type: "audio" },
	{ name: "SE", type: "audio" },
	{ name: "PICT", type: "image" },
];

/**
 * GARBro `BndOpener.TryOpen`. The entry count is an int32 at 0x00 and the word at 0x04 has to be
 * exactly where an index of twelve-byte records ends.
 *
 * Every record is the payload offset, the unpacked size and the stored size, and an entry counts as
 * compressed when those two sizes differ. Entries are named `<archive>#<index>` with a four-digit index
 * and their type comes from the archive name — `SCR`, `VOICE`, `SE` or `PICT`. Only archives with an
 * unnamed type are inspected for a bitmap marker.
 *
 * GARbro registers this opener for debug builds only, which the port mirrors by documenting the
 * limitation rather than dropping the format.
 */
async function readBndIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_OFFSET) + 4n) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET + 4);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = header.readUInt32LE(FIRST_OFFSET);
	if (BigInt(firstOffset) !== BigInt(INDEX_START + count * RECORD_SIZE))
		return undefined;
	if (BigInt(firstOffset) > source.size) return undefined;

	const baseName = basename(sourcePath ?? "")
		.replace(/\.[^.]*$/, "")
		.toUpperCase();
	const defaultType =
		DEFAULT_TYPES.find((candidate) => candidate.name === baseName)?.type ?? "";
	const index = await source.readAt(BigInt(INDEX_START), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_OFFSET),
		);
		const storedSize = BigInt(index.readUInt32LE(record + STORED_SIZE_OFFSET));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(
				`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}`,
			),
			offset,
			size: unpackedSize,
			packedSize: storedSize,
			compressed: unpackedSize !== storedSize,
		});
		if (defaultType) entry.metadata = { type: defaultType };
		else if (unpackedSize !== storedSize) entry.sizeKnown = false;
		entries.push(entry);
	}
	if (!defaultType) await detectFileTypes(source, entries);
	return entries;
}

/** GARBro `BndOpener.DetectFileTypes`, which only looks for bitmap markers. */
async function detectFileTypes(
	source: ByteSource,
	entries: readonly FixedEntry[],
): Promise<void> {
	for (const entry of entries) {
		const available = Math.min(4, Number(entry.packedSize));
		if (available < 4) continue;
		const signature = (
			await source.readAt(entry.offset, available)
		).readUInt32LE(0);
		const isBitmap = entry.compressed
			? (signature & 0xffff) === BMP_SIGNATURE
			: (signature & PREFIXED_BMP_MASK) === PREFIXED_BMP_SIGNATURE;
		if (!isBitmap) continue;
		entry.metadata = { type: "image" };
		entry.path = changeExtension(entry.path, "bmp");
	}
}

/** GARbro `BndOpener.OpenEntry`: compressed payloads are LZSS streams, everything else is stored. */
const bndEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([inflateLzssAll(stored)]);
};

export const shapeShifterBndDescriptor: FormatDescriptor = {
	id: "shapeshifter-bnd",
	name: "Shape Shifter resource archive",
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
			source: "Legacy/ShapeShifter/ArcBND.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const shapeShifterBndFormat: ArchiveFormat = defineFixedArchive({
	descriptor: shapeShifterBndDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readBndIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readBndIndex(source, sourcePath).catch(
			() => undefined,
		);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BND layout");
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	openEntry: bndEntryOpener,
});
