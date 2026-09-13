// Format reference: GARBro Legacy/Paprika/ArcPKDAT.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COMPANION_NAME = "SCNPK.DAT";
/** Archive name prefixes mapped to the companion index slot they use. */
const PREFIXES = [
	undefined,
	undefined,
	undefined,
	"PICPK",
	"AVIPK",
	"MUSPK",
	"WAVPK",
];
const RECORD_SIZE = 9;
const FIRST_SLOT = 3;

export const pkDatDescriptor: FormatDescriptor = {
	id: "paprika-pkdat",
	name: "Paprika resource archive",
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
			source: "Legacy/Paprika/ArcPKDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PkDatOpener.TryOpen`. Every archive is a numbered slice of one shared `SCNPK.DAT` index
 * that lives beside it: the archive name selects an index slot by its prefix (`PICPK`, `AVIPK`,
 * `MUSPK`, or `WAVPK`), the word at that slot points at a record list, and only records whose number
 * byte matches the archive's trailing digit belong to it.
 *
 * GARbro names entries from the running record position and the archive's first three characters, and
 * stops when offsets stop increasing.
 */
async function readPkDatIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const archiveName = basename(sourcePath).toUpperCase();
	const baseName = archiveName.replace(/\.[^.]*$/, "");
	const last = baseName.slice(-1);
	if (!/[0-9]/.test(last)) return undefined;
	const archiveNumber = Number.parseInt(last, 10);
	let slot = -1;
	for (let id = FIRST_SLOT; id < PREFIXES.length; id += 1) {
		const prefix = PREFIXES[id];
		if (prefix !== undefined && archiveName.startsWith(prefix)) {
			slot = id;
			break;
		}
	}
	if (slot === -1) return undefined;
	if (archiveName.length < 3) return undefined;
	const baseExtension = archiveName.slice(0, 3);

	const companion = await readCompanionFile(sourcePath, COMPANION_NAME);
	if (!companion) return undefined;
	if (slot * 4 + 4 > companion.length) return undefined;
	const indexPosition = companion.readUInt32LE(slot * 4);
	if (indexPosition === 0 || indexPosition >= companion.length)
		return undefined;

	const entries: FixedEntry[] = [];
	let position = indexPosition;
	let record = 0;
	let lastOffset = -1n;
	while (position + RECORD_SIZE <= companion.length) {
		const number = companion[position] ?? 0;
		const offset = BigInt(companion.readUInt32LE(position + 1));
		const size = BigInt(companion.readUInt32LE(position + 5));
		position += RECORD_SIZE;
		record += 1;
		if (number !== archiveNumber) continue;
		if (lastOffset >= 0n && offset < lastOffset) break;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					`${String(record - 1).padStart(4, "0")}.${baseExtension}`,
				),
				offset,
				size,
			}),
		);
		lastOffset = offset;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const pkDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pkDatDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPkDatIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPkDatIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Paprika DAT layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
