// Format reference: GARBro Legacy/Factor/ArcRES.cs, class `PackOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** GARbro `PackNameRe`: the archive name is a number behind `pack`. */
const PACK_NAME = /^pack(\d)$/;
const SIZE_SIZE = 4;
const NAME_WIDTH = 4;
/** Names carrying this extension are handed out inverted. */
const XOR_EXTENSION = ".res";
const XOR_KEY = 0x80;

/**
 * GARBro `PackOpener.TryOpen`. The format has no signature at all — its only recognition is the
 * archive's name, which has to be `pack` followed by one digit, and the extension filter GARbro
 * registers, which is the empty extension, so only files without one are considered.
 *
 * The body is an unnamed walk: every entry starts with a 32-bit size, its payload follows, and the
 * next size comes right behind it. The reference's commented-out name table is not reproduced, so
 * entry names are generated from the archive name with a four digit index and the archive's own
 * extension, which is empty by construction.
 */
async function readPackIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	const name = basename(sourcePath ?? "");
	if (extname(name) !== "") return undefined;
	const match = PACK_NAME.exec(name);
	if (!match) return undefined;
	const baseName = name;

	const entries: FixedEntry[] = [];
	let offset = 0n;
	while (offset < source.size) {
		if (offset + BigInt(SIZE_SIZE) > source.size) return undefined;
		const header = await source.readAt(offset, SIZE_SIZE);
		const size = BigInt(header.readUInt32LE(0));
		offset += BigInt(SIZE_SIZE);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					`${baseName}#${String(entries.length).padStart(NAME_WIDTH, "0")}`,
				),
				offset,
				size,
			}),
		);
		offset += size;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARbro `PackOpener.OpenEntry`: payloads pass through, unless the name asks for inversion. */
const packEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	if (entry.path.toLowerCase().endsWith(XOR_EXTENSION)) {
		for (let index = 0; index < stored.length; index += 1)
			stored[index] = (stored[index] ?? 0) ^ XOR_KEY;
	}
	return Readable.from([stored]);
};

export const factorResDescriptor: FormatDescriptor = {
	id: "factor-res",
	name: "Factor resource archive",
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
			source: "Legacy/Factor/ArcRES.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const factorResFormat: ArchiveFormat = defineFixedArchive({
	descriptor: factorResDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPackIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPackIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid pack layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: packEntryOpener,
});
