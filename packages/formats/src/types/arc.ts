// Format reference: GARbro Legacy/Types/ArcARC.cs
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

const MAXIMUM_NAME_LENGTH = 0x100;
const MAXIMUM_ARCHIVE_SIZE = 0xffffffffn;

export const typesArcDescriptor: FormatDescriptor = {
	id: "types-arc",
	name: "Types resource archive",
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
			source: "Legacy/Types/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (sourceExtension(sourcePath) !== "arc") return false;
	if (source.size > MAXIMUM_ARCHIVE_SIZE) return false;
	return source.size >= 10n;
}

async function readTypesArc(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Types ARC layout");
	}
	const entries: FixedEntry[] = [];
	let position = 0n;
	while (position + 10n <= source.size) {
		const header = await source.readAt(position, 10);
		const size = BigInt(header.readUInt32LE(0));
		if (size === 0n) break;
		const nameLength = header.readUInt16LE(8);
		if (nameLength === 0 || nameLength > MAXIMUM_NAME_LENGTH) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Types ARC entry name length is invalid",
			);
		}
		if (position + 10n + BigInt(nameLength) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Types ARC index is truncated");
		}
		const nameField = await source.readAt(position + 10n, nameLength);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Types ARC entry has an empty name",
			);
		}
		const offset = position + 10n + BigInt(nameLength);
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Types ARC entry points outside the archive: ${name}`,
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
		position = offset + size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Types ARC archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const typesArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: typesArcDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readTypesArc,
});
