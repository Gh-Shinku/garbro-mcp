// Format reference: GARBro Legacy/Tako/ArcMPK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const SIGNATURES = [
	Buffer.from("HG-P", "ascii"),
	Buffer.from("HG-W", "ascii"),
] as const;
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const VERSION_OFFSET = 3;
/** The `HG-P` variant stores offsets only. */
const OFFSET_ONLY_VERSION = 0x50;
const COMPANION_NAME = "00.mpk";
const LIST_KEY = 0x0a;
const GENERATED_NAME_FORMAT = 4;

export const mpkHgDescriptor: FormatDescriptor = {
	id: "tako-mpk",
	name: "Studio Tako resource archive",
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
			source: "Legacy/Tako/ArcMPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `MpkOpener.TryOpen`. Besides the `HG-P`/`HG-W` signature the archive stores a record count
 * at 4 and records from 8; the `HG-W` variant carries a size per record while `HG-P` stores offsets
 * only and derives sizes.
 *
 * Entry names come from a companion `00.mpk` list in the same directory: the whole file is XORed with
 * 0x0a and read as CP932 lines. Without that file GARbro generates `<archive>#<n padded to 4>` names.
 * The list file itself is rejected as an archive.
 */
async function readMpkIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath).toLowerCase() === COMPANION_NAME) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (
		!SIGNATURES.some((signature) =>
			header.subarray(0, signature.length).equals(signature),
		)
	)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const hasSizes = (header[VERSION_OFFSET] ?? 0) !== OFFSET_ONLY_VERSION;
	const recordSize = hasSizes ? 8 : 4;
	const indexSize = count * recordSize;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;

	let names: string[] | undefined;
	const companion = await readCompanionFile(sourcePath, COMPANION_NAME);
	if (companion) {
		const decoded = Buffer.from(companion);
		for (let position = 0; position < decoded.length; position += 1)
			decoded[position] = (decoded[position] ?? 0) ^ LIST_KEY;
		names = decoded
			.toString("latin1")
			.split("\n")
			.map((line) => line.replace(/\r$/, ""));
	}
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");

	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * recordSize;
		const name =
			names?.[id] ??
			`${baseName}#${String(id).padStart(GENERATED_NAME_FORMAT, "0")}`;
		const offset = BigInt(index.readUInt32LE(record));
		if (hasSizes) {
			const size = BigInt(index.readUInt32LE(record + 4));
			if (!checkPlacement(offset, size, source.size)) return undefined;
			entries.push(
				createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
			);
		} else {
			if (offset > source.size) return undefined;
			entries.push(
				createFixedEntry({ id, ...normalizeEntryPath(name), offset, size: 0n }),
			);
		}
	}
	if (entries.length === 0) return undefined;
	if (!hasSizes) {
		for (const [position, entry] of entries.entries()) {
			const next = entries[position + 1]?.offset ?? source.size;
			const size = next - entry.offset;
			if (size < 0n || !checkPlacement(entry.offset, size, source.size))
				return undefined;
			entry.size = size;
			entry.packedSize = size;
		}
	}
	return entries;
}

export const mpkHgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mpkHgDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMpkIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMpkIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio Tako MPK layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
