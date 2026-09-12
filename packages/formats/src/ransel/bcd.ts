// Format reference: GARbro Legacy/Ransel/ArcBCD.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { basename } from "node:path";

const SIGNATURE = Buffer.from("BinaryCombineData", "ascii");
const SECTION_HEADER = "[BinaryCombineData]";

export const bcdDescriptor: FormatDescriptor = {
	id: "ransel-bcd",
	name: "ransel engine resource archive",
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
			source: "Legacy/Ransel/ArcBCD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface BcdEntry {
	path: string;
	offset: bigint;
	size: bigint;
}

function parseIndexFile(
	text: string,
	sourcePath: string,
): BcdEntry[] | undefined {
	const lines = text.split(/\r?\n/).map((line) => line.trimEnd());
	let position = 0;
	if (lines[position] !== SECTION_HEADER) return undefined;
	position += 1;
	const fileName = (lines[position] ?? "").trim();
	position += 1;
	if (basename(sourcePath).toLowerCase() !== fileName.toLowerCase())
		return undefined;
	position += 1;
	const entries: BcdEntry[] = [];
	while (position < lines.length) {
		const header = lines[position] ?? "";
		if (header.length === 0) {
			position += 1;
			continue;
		}
		if (!header.startsWith("[") || !header.endsWith("]")) return undefined;
		const name = header.slice(1, -1);
		const offsetText = lines[position + 1] ?? "";
		const sizeText = lines[position + 2] ?? "";
		if (!/^\d+$/.test(offsetText) || !/^\d+$/.test(sizeText)) return undefined;
		entries.push({
			path: normalizeEntryPath(name).path,
			offset: BigInt(offsetText),
			size: BigInt(sizeText),
		});
		position += 4;
	}
	return entries.length > 0 ? entries : undefined;
}

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(SIGNATURE.length)) return undefined;
	const signature = await source.readAt(0n, SIGNATURE.length);
	if (!signature.equals(SIGNATURE)) return undefined;
	const companion = await readCompanionFile(
		sourcePath,
		changeExtension(sourcePath, "bcl"),
	);
	if (!companion) return undefined;
	const parsed = parseIndexFile(decodeCp932(companion), sourcePath);
	if (!parsed) return undefined;
	const entries: FixedEntry[] = [];
	for (const [id, record] of parsed.entries()) {
		if (!checkPlacement(record.offset, record.size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`ransel BCD entry points outside the archive: ${record.path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: record.path,
				offset: record.offset,
				size: record.size,
			}),
		);
	}
	return entries;
}

export const bcdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bcdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ransel BCD layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
