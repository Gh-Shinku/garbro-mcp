// Format reference: GARbro ArcFormats/Groover/ArcPCG.cs, class `DatOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Only archives named like `NAME01.dat` own a companion index. */
const ARCHIVE_NAME_PATTERN = /^((.+)0\d)\.dat$/i;
const DATA_EXTENSION = ".dat";
/** The index is looked up under these extensions, in order. */
const INDEX_EXTENSIONS = ["pcg", "spf"];
const PART_COUNT_FIELD = 0;
const COUNT_FIELD = 4;
const PART_NAME_OFFSET = 8;
const PART_NAME_SIZE = 0x20;
const FIRST_INDEX_OFFSET = 0x148;
const LAST_INDEX_OFFSET = 0x170;
const INDEX_HEADER_SIZE = 0x198;
const MAX_PARTS = 10;
const MIN_ENTRY_SIZE = 0x30;
const LONG_ENTRY_SIZE = 0x48;
const SHORT_NAME_SIZE = 0x20;
const LONG_NAME_SIZE = 0x40;

interface GrooverEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

/** `DatOpener.TryOpen`: the archive name selects the part, which carries its own entry range. */
export function readGrooverIndex(
	index: Buffer,
	archiveName: string,
	sourceSize: bigint,
): GrooverEntry[] | undefined {
	if (index.length < INDEX_HEADER_SIZE) return undefined;
	const partsCount = index.readInt32LE(PART_COUNT_FIELD);
	const count = index.readInt32LE(COUNT_FIELD);
	if (partsCount > MAX_PARTS || !isSaneCount(count)) return undefined;
	const entrySize = Math.floor((index.length - INDEX_HEADER_SIZE) / count);
	if (entrySize < MIN_ENTRY_SIZE) return undefined;
	let firstIndex = -1;
	let lastIndex = -1;
	for (let part = 0; part < partsCount; part += 1) {
		const namePosition = PART_NAME_OFFSET + part * PART_NAME_SIZE;
		const nameField = index.subarray(
			namePosition,
			namePosition + PART_NAME_SIZE,
		);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		if (name !== archiveName) continue;
		firstIndex = index.readInt32LE(FIRST_INDEX_OFFSET + part * 4);
		lastIndex = index.readInt32LE(LAST_INDEX_OFFSET + part * 4);
		break;
	}
	if (firstIndex < 0 || firstIndex >= lastIndex || lastIndex > count)
		return undefined;
	const nameSize =
		entrySize >= LONG_ENTRY_SIZE ? LONG_NAME_SIZE : SHORT_NAME_SIZE;
	const entries: GrooverEntry[] = [];
	let position = INDEX_HEADER_SIZE + entrySize * firstIndex;
	for (let id = firstIndex; id < lastIndex; id += 1) {
		const nameField = index.subarray(position, position + nameSize);
		const end = nameField.indexOf(0);
		const name = decodeCp932(
			end === -1 ? nameField : nameField.subarray(0, end),
		);
		const offset = BigInt(index.readUInt32LE(position + nameSize));
		const size = BigInt(index.readUInt32LE(position + nameSize + 4));
		if (!checkPlacement(offset, size, sourceSize)) return undefined;
		entries.push({ name, offset, size });
		position += entrySize;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** The companion index is named after the archive without its trailing digits. */
function indexCandidates(archiveName: string): string[] | undefined {
	const match = ARCHIVE_NAME_PATTERN.exec(archiveName);
	if (!match?.[2]) return undefined;
	const base = match[2];
	return INDEX_EXTENSIONS.map((extension) => `${base}.${extension}`);
}

async function readIndexFile(
	sourcePath: string,
): Promise<{ index: Buffer; archiveName: string } | undefined> {
	const archiveName = sourcePath.split(/[\\/]/).pop() ?? "";
	if (!archiveName.toLowerCase().endsWith(DATA_EXTENSION)) return undefined;
	const candidates = indexCandidates(archiveName);
	if (!candidates) return undefined;
	for (const candidate of candidates) {
		const index = await readCompanionFile(sourcePath, candidate);
		if (index) return { index, archiveName };
	}
	return undefined;
}

async function readGroover(
	source: ByteSource,
	sourcePath: string,
): Promise<GrooverEntry[] | undefined> {
	const found = await readIndexFile(sourcePath);
	if (!found) return undefined;
	return readGrooverIndex(found.index, found.archiveName, source.size);
}

function toFixedEntries(entries: readonly GrooverEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			metadata: { type: "data" },
		}),
	);
}

export const grooverPcgDescriptor: FormatDescriptor = {
	id: "groover-pcg",
	name: "Groover resource archive",
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
			source: "ArcFormats/Groover/ArcPCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const grooverPcgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: grooverPcgDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGroover(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGroover(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Groover layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
