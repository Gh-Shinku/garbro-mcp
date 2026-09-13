// Format reference: GARbro Legacy/Rare/ArcX.cs, class `XOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { inflateRareData } from "./rare-lz.js";

/** The archive has to be called `PP.X` next to the game executable that carries its index. */
const ARCHIVE_NAME = "PP.X";
const INDEX_EXECUTABLE = "seisen.exe";
/** The reference hard-codes the index position and length for the single supported game. */
const INDEX_OFFSET = 0x3a9a0;
const INDEX_COUNT = 715;
const INDEX_RECORD_SIZE = 12;
const NAME_DIGITS = 5;

interface RareEntry {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
}

function archiveNameFrom(sourcePath: string): string {
	return sourcePath.split(/[\\/]/).pop() ?? "";
}

/** `XOpener.TryOpen`: the index lives inside the game executable, the payloads in `PP.X`. */
async function readEntries(
	source: ByteSource,
	sourcePath: string,
): Promise<RareEntry[] | undefined> {
	if (archiveNameFrom(sourcePath).toUpperCase() !== ARCHIVE_NAME)
		return undefined;
	const executable = await readCompanionFile(sourcePath, INDEX_EXECUTABLE);
	if (!executable) return undefined;
	const indexSize = INDEX_RECORD_SIZE * INDEX_COUNT;
	if (INDEX_OFFSET + indexSize > executable.length) return undefined;
	const index = executable.subarray(INDEX_OFFSET, INDEX_OFFSET + indexSize);
	const entries: RareEntry[] = [];
	for (let id = 0; id < INDEX_COUNT; id += 1) {
		const base = id * INDEX_RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(base));
		const size = BigInt(index.readUInt32LE(base + 4));
		const unpackedSize = BigInt(index.readUInt32LE(base + 8));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			name: `PP#${String(id).padStart(NAME_DIGITS, "0")}.BMP`,
			offset,
			size,
			unpackedSize,
		});
	}
	return entries;
}

export const rareXDescriptor: FormatDescriptor = {
	id: "rare-x",
	name: "Rare resource archive",
	extensions: ["x"],
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
			source: "Legacy/Rare/ArcX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const rareXFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rareXDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEntries(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readEntries(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Rare archive layout");
		return {
			entries: entries.map((entry, id) =>
				createFixedEntry({
					id,
					...normalizeEntryPath(entry.name),
					offset: entry.offset,
					size: entry.unpackedSize,
					packedSize: entry.size,
					compressed: true,
					metadata: { type: "image" },
				}),
			),
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize ?? entry.size)),
		);
		return Readable.from([inflateRareData(stored, Number(entry.size))]);
	},
});
