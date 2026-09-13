// Format reference: GARbro ArcFormats/Eternity/ArcMiris.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateSync } from "node:zlib";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readCompanionFile } from "../shared/companion.js";
import { basename } from "node:path";

const INDEX_ENTRY = /([^,]+),(\d+),(\d+)#/g;

export const mirisDatDescriptor: FormatDescriptor = {
	id: "miris-dat",
	name: "Studio Miris resource archive",
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
			source: "ArcFormats/Eternity/ArcMiris.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "dat") return undefined;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const companionName = `${baseName}l.dat`;
	const companion = await readCompanionFile(sourcePath, companionName);
	if (!companion) return undefined;
	let text: string;
	try {
		text = decodeCp932(inflateSync(companion));
	} catch {
		return undefined;
	}
	if (text.length === 0) return undefined;
	const entries: FixedEntry[] = [];
	for (const match of text.matchAll(INDEX_ENTRY)) {
		const name = match[1] ?? "";
		const size = BigInt(match[2] ?? "0");
		const offset = BigInt(match[3] ?? "0");
		if (name.length === 0) continue;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Studio Miris entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

export const mirisDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mirisDatDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "dat") return false;
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Studio Miris index");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
