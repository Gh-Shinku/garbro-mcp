// Format reference: GARbro Legacy/Desire/ArcDSV.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSIONS = new Set(["000", "001", "002", "003"]);
const NAME_SIZE = 0x0c;
const RECORD_SIZE = 0x10;

export const dsvDescriptor: FormatDescriptor = {
	id: "desire-dsv",
	name: "Desire resource archive",
	extensions: ["000", "001", "002", "003"],
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
			source: "Legacy/Desire/ArcDSV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isAscii(value: number): boolean {
	return value >= 0x20 && value < 0x7f;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (!EXTENSIONS.has(sourceExtension(sourcePath))) return false;
	const first = (await source.readAt(0n, 1))[0] ?? 0;
	return isAscii(first);
}

async function readDsv(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Desire DSV layout");
	}
	const records: { path: string; rawPath?: string; size: bigint }[] = [];
	let position = 0n;
	while (position < source.size) {
		const first = (await source.readAt(position, 1))[0] ?? 0;
		if (first === 0) break;
		if (!isAscii(first)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Desire DSV entry name is not ASCII",
			);
		}
		if (position + BigInt(RECORD_SIZE) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Desire DSV index is truncated");
		}
		const record = await source.readAt(position, RECORD_SIZE);
		const field = record.subarray(0, NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		const size = BigInt(record.readUInt32LE(NAME_SIZE));
		if (size === 0n || size >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Desire DSV entry size is invalid",
			);
		}
		records.push({ ...normalizeEntryPath(name), size });
		position += BigInt(RECORD_SIZE);
	}
	if (position + BigInt(RECORD_SIZE) > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Desire DSV terminator is missing",
		);
	}
	const terminatorRecord = await source.readAt(position, RECORD_SIZE);
	if (terminatorRecord.readUInt32LE(NAME_SIZE) !== 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Desire DSV terminator record is invalid",
		);
	}
	let offset = position + BigInt(RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		if (!checkPlacement(offset, record.size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Desire DSV entry points outside the archive: ${record.path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: record.path,
				...(record.rawPath === undefined ? {} : { rawPath: record.rawPath }),
				offset,
				size: record.size,
			}),
		);
		offset += record.size;
	}
	if (offset !== source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Desire DSV payloads do not cover the whole file",
		);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Desire DSV archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const dsvFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dsvDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readDsv,
});
