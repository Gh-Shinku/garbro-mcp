// Format reference: GARbro ArcFormats/Kiss/ArcARC.cs
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
	isSaneCount,
	normalizeEntryPath,
	readCStringAt,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 4;
const MAXIMUM_NAME_LENGTH = 0x400;

export const kissArcDescriptor: FormatDescriptor = {
	id: "kiss-arc",
	name: "Kiss resource archive",
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
			source: "ArcFormats/Kiss/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<number | undefined> {
	if (sourceExtension(sourcePath) !== "arc") return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const count = (await source.readAt(0n, HEADER_SIZE)).readInt32LE(0);
	return isSaneCount(count) ? count : undefined;
}

async function readKissArc(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source, sourcePath);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Kiss ARC layout");
	}
	const records: { path: string; rawPath?: string; offset: bigint }[] = [];
	let position = BigInt(HEADER_SIZE);
	let previousOffset = BigInt(HEADER_SIZE);
	for (let id = 0; id < count; id += 1) {
		if (position >= source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Kiss ARC index is truncated");
		}
		const { value: name, end } = await readCStringAt(
			source,
			position,
			MAXIMUM_NAME_LENGTH,
		);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Kiss ARC entry has an empty name",
			);
		}
		position = end;
		if (position + 8n > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Kiss ARC index is truncated");
		}
		const offset = (await source.readAt(position, 8)).readBigInt64LE(0);
		position += 8n;
		if (offset < previousOffset || offset > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Kiss ARC entry points outside the archive: ${name}`,
			);
		}
		previousOffset = offset;
		const normalized = normalizeEntryPath(name);
		records.push({ ...normalized, offset });
	}
	const entries: FixedEntry[] = records.map((record, id) => {
		const nextOffset = records[id + 1]?.offset ?? source.size;
		const size = nextOffset - record.offset;
		if (!checkPlacement(record.offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Kiss ARC entry points outside the archive: ${record.path}`,
			);
		}
		return createFixedEntry({
			id,
			path: record.path,
			...(record.rawPath === undefined ? {} : { rawPath: record.rawPath }),
			offset: record.offset,
			size,
		});
	});
	return { entries, metadata: { entryCount: count } };
}

export const kissArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kissArcDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readKissArc,
});
