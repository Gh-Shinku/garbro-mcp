// Format reference: GARbro ArcFormats/Winters/ArcIFX.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { basename, extname } from "node:path";

const INDEX_OFFSET = 0x20;
const INDEX_LIMIT = 0x10000;
const RECORD_SIZE = 0x10;

export const ifxDescriptor: FormatDescriptor = {
	id: "winters-ifx",
	name: "Winters resource archive",
	extensions: ["ifx"],
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
			source: "ArcFormats/Winters/ArcIFX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (sourceExtension(sourcePath) !== "ifx") return false;
	return source.size > BigInt(INDEX_LIMIT);
}

async function readIfx(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Winters IFX layout");
	}
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		INDEX_LIMIT - INDEX_OFFSET,
	);
	const baseName = basename(sourcePath, extname(sourcePath));
	const entries: FixedEntry[] = [];
	for (let position = 0; position < index.length; position += RECORD_SIZE) {
		if (index.readUInt16LE(position) === 0) continue;
		const offset = BigInt(index.readUInt32LE(position + 4));
		const size = BigInt(index.readUInt32LE(position + 8));
		const id = position / RECORD_SIZE;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Winters IFX entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(5, "0")}`,
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Winters IFX archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const ifxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ifxDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readIfx,
});
