// Format reference: GARbro ArcFormats/Silky/ArcARC.cs
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;

export const silkyArcDescriptor: FormatDescriptor = {
	id: "silky-arc",
	name: "Silky's resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Silky/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface SilkyHeader {
	count: number;
	indexSize: number;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<SilkyHeader | undefined> {
	if (sourceExtension(sourcePath) !== "arc") return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	// The first record must be structurally valid, which keeps the extension-based
	// detection from claiming arbitrary .arc files.
	const first = await source.readAt(BigInt(INDEX_OFFSET), RECORD_SIZE);
	if (decodeCStringField(first, 0, NAME_SIZE).length === 0) return undefined;
	const offset = BigInt(first.readUInt32LE(NAME_SIZE));
	const size = BigInt(first.readUInt32LE(NAME_SIZE + 4));
	if (offset < BigInt(INDEX_OFFSET + indexSize)) return undefined;
	if (!checkPlacement(offset, size, source.size)) return undefined;
	return { count, indexSize };
}

async function readSilkyArc(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source, sourcePath);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Silky's ARC layout");
	}
	const { count, indexSize } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const seenOffsets = new Set<string>();
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Silky's ARC entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE + 4));
		if (
			offset < BigInt(INDEX_OFFSET + indexSize) ||
			!checkPlacement(offset, size, source.size)
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Silky's ARC entry points outside the archive: ${name}`,
			);
		}
		const key = offset.toString();
		if (seenOffsets.has(key)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Silky's ARC has duplicate offsets: ${name}`,
			);
		}
		seenOffsets.add(key);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const silkyArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: silkyArcDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readSilkyArc,
});
