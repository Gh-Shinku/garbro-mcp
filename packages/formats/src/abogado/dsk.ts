// Format reference: GARBro ArcFormats/Abogado/ArcDSK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const COMPANION_EXTENSION = "pft";
const HEADER_SIZE_OFFSET = 0;
const CLUSTER_SIZE_OFFSET = 2;
const COUNT_OFFSET = 4;
const NAME_SIZE = 8;
/** GARbro's archive-name to extension map, compared case-insensitively. */
const EXTENSION_MAP = new Map(
	[
		["BACK", "KG"],
		["BUST", "KG"],
		["EVENT", "KG"],
		["SYSTEM", "KG"],
		["VISUAL", "KG"],
		["SETTEI", "KG"],
		["THUMB", "KG"],
		["SCENE", "SCF"],
		["SOUND", "ADP"],
		["PCM1", "ADP"],
		["PCM2", "ADP"],
		["PCM", "ADP"],
		["ADPCM", "ADP"],
		["GRAPHIC", "KG"],
		["GRPFILE", "KG"],
		["EFCFILE", "ADP"],
		["PCMFILE", "ADP"],
		["SCENARIO", "SCF"],
	].map(([name, extension]) => [name, extension] as const),
);

export const dskDescriptor: FormatDescriptor = {
	id: "abogado-dsk",
	name: "AbogadoPowers resource archive",
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
			source: "ArcFormats/Abogado/ArcDSK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `ReadCString`: up to `maxLength` bytes, ending at the first NUL. */
function readName(
	buffer: Buffer,
	offset: number,
	maxLength: number,
): { name: string; end: number } {
	const length = Math.min(maxLength, buffer.length - offset);
	const field = buffer.subarray(offset, offset + length);
	const terminator = field.indexOf(0);
	if (terminator === -1)
		return { name: decodeCp932(field), end: offset + length };
	return {
		name: decodeCp932(field.subarray(0, terminator)),
		end: offset + terminator + 1,
	};
}

/**
 * GARBro `DskOpener.TryOpen`. The `.dsk` file holds only payloads; a sibling `.pft` file holds the
 * index: a 16-bit header size, a 16-bit cluster size, and a 32-bit record count. Records start at
 * the header size and hold a NUL-terminated name of at most eight bytes; names that are empty carry
 * no tail, while every other record continues with a cluster index and the stored size, which
 * GARbro multiplies by the cluster size.
 *
 * GARbro maps the archive name to an extension (for example `BACK` to `KG`) and rewrites the stored
 * names accordingly.
 */
async function readDskIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const companion = await readCompanionFile(
		sourcePath,
		`${baseName}.${COMPANION_EXTENSION}`,
	);
	if (!companion) return undefined;
	if (companion.length < COUNT_OFFSET + 4) return undefined;
	const headerSize = companion.readUInt16LE(HEADER_SIZE_OFFSET);
	const clusterSize = BigInt(companion.readUInt16LE(CLUSTER_SIZE_OFFSET));
	const count = companion.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (headerSize > companion.length) return undefined;
	const extension = EXTENSION_MAP.get(baseName.toUpperCase()) ?? "";
	const entries: FixedEntry[] = [];
	let position = headerSize;
	for (let id = 0; id < count; id += 1) {
		if (position >= companion.length) return undefined;
		const { name, end } = readName(companion, position, NAME_SIZE);
		position = end;
		if (name.length === 0) continue;
		if (position + 8 > companion.length) return undefined;
		const offset = clusterSize * BigInt(companion.readUInt32LE(position));
		const size = BigInt(companion.readUInt32LE(position + 4));
		position += 8;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					extension.length === 0 ? name : changeExtension(name, extension),
				),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const dskFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dskDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDskIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDskIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid AbogadoPowers DSK layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
