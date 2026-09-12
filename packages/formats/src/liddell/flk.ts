// Format reference: GARbro Legacy/Liddell/ArcFLK.cs
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
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const RECORD_SIZE = 0x10;
const NAME_OFFSET = 4;
const NAME_SIZE = 12;
const MAXIMUM_ENTRIES = 0x40000;

export const flkDescriptor: FormatDescriptor = {
	id: "liddell-flk",
	name: "Liddell resource archive",
	extensions: ["flk"],
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
			source: "Legacy/Liddell/ArcFLK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readRecord(
	source: ByteSource,
	position: number,
): Promise<Buffer> {
	if (BigInt(position + RECORD_SIZE) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Liddell FLK index is truncated");
	}
	return source.readAt(BigInt(position), RECORD_SIZE);
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (sourceExtension(sourcePath) !== "flk") return false;
	if (source.size < BigInt(RECORD_SIZE)) return false;
	const first = await source.readAt(0n, RECORD_SIZE);
	return (first[4] ?? 0) !== 0;
}

async function readFlk(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Liddell FLK layout");
	}
	let position = 0;
	let buffer = await readRecord(source, position);
	const baseOffset = (buffer[3] ?? 0) << 8;
	let nextOffset =
		(((buffer[1] ?? 0) << 8) | (buffer[0] ?? 0)) * 0x10 + baseOffset;
	const entries: FixedEntry[] = [];
	while ((buffer[4] ?? 0) !== 0) {
		if (entries.length >= MAXIMUM_ENTRIES) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Liddell FLK index does not terminate",
			);
		}
		const tailSize = buffer[2] ?? 0;
		const name = decodeCStringField(buffer, NAME_OFFSET, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Liddell FLK entry has an empty name",
			);
		}
		const offset = BigInt(nextOffset);
		position += RECORD_SIZE;
		buffer = await readRecord(source, position);
		nextOffset =
			(((buffer[3] ?? 0) << 16) | ((buffer[1] ?? 0) << 8) | (buffer[0] ?? 0)) *
				0x10 +
			baseOffset;
		let size = BigInt(nextOffset) - offset;
		if (tailSize !== 0) size += BigInt(tailSize - RECORD_SIZE);
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Liddell FLK entry points outside the archive: ${name}`,
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
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Liddell FLK archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const flkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: flkDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readFlk,
});
