// Format reference: GARBro ArcFormats/Slg/ArcSPD.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
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

const SIGNATURE = Buffer.from("SFP\0", "latin1");
const COMPANION_EXTENSION = "SPL";
const ALIGN_OFFSET = 0x0c;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;
const SIZE_OFFSET = 4;
const OFFSET_OFFSET = 8;

export const spdDescriptor: FormatDescriptor = {
	id: "slg-spd",
	name: "SLG system audio archive",
	extensions: ["spd"],
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
			source: "ArcFormats/Slg/ArcSPD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `SpdOpener.TryOpen`. The `.spd` file holds only payloads; its index lives in a sibling
 * `.SPL` file, which must start with `SFP\0`. The companion stores an alignment factor at 0x0c and
 * the name-blob offset at 0x20, which also sizes the record list: records are counted from there in
 * 0x10-byte steps. Every record holds a name offset, the stored size, and a data offset that is
 * multiplied by the alignment factor.
 *
 * GARbro derives the entry names from the companion's name blob and never reads names from the
 * payload file itself.
 */
async function readSpdIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const companion = await readCompanionFile(
		sourcePath,
		`${baseName}.${COMPANION_EXTENSION}`,
	);
	if (!companion) return undefined;
	if (companion.length < INDEX_OFFSET) return undefined;
	if (!companion.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const align = BigInt(companion.readUInt32LE(ALIGN_OFFSET));
	const namesOffset = companion.readUInt32LE(INDEX_OFFSET);
	if (namesOffset > companion.length || namesOffset <= INDEX_OFFSET)
		return undefined;
	const count = Math.floor((namesOffset - INDEX_OFFSET) / RECORD_SIZE);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		if (record + RECORD_SIZE > companion.length) return undefined;
		const nameOffset = companion.readUInt32LE(record);
		if (nameOffset < namesOffset || nameOffset >= companion.length)
			return undefined;
		const terminator = companion.indexOf(0, nameOffset);
		const name = decodeCp932(
			companion.subarray(
				nameOffset,
				terminator === -1 ? companion.length : terminator,
			),
		);
		if (name.trim().length === 0) return undefined;
		const size = BigInt(companion.readUInt32LE(record + SIZE_OFFSET));
		const offset =
			BigInt(companion.readUInt32LE(record + OFFSET_OFFSET)) * align;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const spdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: spdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSpdIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSpdIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid SLG SPD layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
