// Format reference: GARBro Legacy/Marron/ArcCPN.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const EXTENSION = "dat";
const COMPANION_EXTENSION = "cpn";
const INDEX_PATTERN = /#(?:\.\/)?([^$]+)\$(\d+)\*(\d+)\+/g;

export const cpnDescriptor: FormatDescriptor = {
	id: "marron-cpn",
	name: "Marron resource archive",
	extensions: ["dat"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "Legacy/Marron/ArcCPN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `DatOpener.TryOpen`. The `.dat` file holds only payloads; a sibling `.cpn` file holds a
 * text index whose first byte is the XOR key for the rest of the file. The text starts with the
 * archive name behind a leading character, then a `#`, and entries follow as
 * `#<name>$<offset>*<size>+` records. GARbro requires the stored name to match the archive's file
 * name before it reads any entry.
 *
 * Payloads are XOR-decrypted with the same key.
 */
async function readCpnIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; key: number } | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const companion = await readCompanionFile(
		sourcePath,
		`${baseName}.${COMPANION_EXTENSION}`,
	);
	if (!companion || companion.length < 2) return undefined;
	const key = companion[0] ?? 0;
	const decoded = Buffer.from(companion.subarray(1));
	for (let position = 0; position < decoded.length; position += 1)
		decoded[position] = (decoded[position] ?? 0) ^ key;
	const text = decodeCp932(decoded);
	const marker = text.indexOf("#", 1);
	if (marker <= 1) return undefined;
	const dataName = text.slice(1, marker);
	if (basename(sourcePath).toLowerCase() !== dataName.toLowerCase())
		return undefined;

	const entries: FixedEntry[] = [];
	INDEX_PATTERN.lastIndex = marker;
	for (;;) {
		const match = INDEX_PATTERN.exec(text);
		if (!match) break;
		const name = match[1] ?? "";
		const offset = BigInt(match[2] ?? "0");
		const size = BigInt(match[3] ?? "0");
		if (name.length === 0 || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: key !== 0,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return { entries, key };
}

const cpnEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	const key = entry.metadata?.key;
	if (typeof key === "number" && key !== 0) {
		for (let position = 0; position < payload.length; position += 1)
			payload[position] = (payload[position] ?? 0) ^ key;
	}
	return Readable.from([payload]);
};

export const cpnFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cpnDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCpnIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readCpnIndex(source, sourcePath);
		if (!index)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Marron DAT layout or missing companion index",
			);
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { ...entry.metadata, key: index.key },
		}));
		return {
			entries,
			metadata: { entryCount: entries.length, key: index.key },
		};
	},
	openEntry: cpnEntryOpener,
});
