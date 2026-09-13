// Format reference: GARbro Legacy/Witch/ArcARC.cs
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

const SIGNATURE = Buffer.from("ARC ", "ascii");
const DIR_TAG = Buffer.from([0x44, 0x49, 0x52, 0x20, 0, 0, 0, 0]);
const INDEX_OFFSET = 0x10;
const FIXED_SIZE = 0x28;

export const witchArcDescriptor: FormatDescriptor = {
	id: "witch-arc",
	name: "Witch resource archive",
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
			source: "Legacy/Witch/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<boolean> {
	if (source.size < BigInt(INDEX_OFFSET)) return false;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return false;
	return header.readInt32LE(4) === 0;
}

async function readWitchArc(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	if (!(await parseHeader(source))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Witch ARC layout");
	}
	const entries: FixedEntry[] = [];
	let position = BigInt(INDEX_OFFSET);
	while (position + BigInt(FIXED_SIZE) <= source.size) {
		const fixed = await source.readAt(position, FIXED_SIZE);
		if (!fixed.subarray(0, 8).equals(DIR_TAG)) break;
		const nameLength = fixed.readInt32LE(12);
		if (nameLength <= 0 || nameLength > 0x400) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Witch ARC entry name length is invalid",
			);
		}
		const size = BigInt(fixed.readUInt32LE(0x20));
		const offset = BigInt(fixed.readUInt32LE(0x24));
		if (position + BigInt(FIXED_SIZE + nameLength) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Witch ARC index is truncated");
		}
		const nameField = await source.readAt(
			position + BigInt(FIXED_SIZE),
			nameLength,
		);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Witch ARC entry points outside the archive: ${name}`,
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
		position += BigInt(FIXED_SIZE + nameLength);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Witch ARC archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const witchArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: witchArcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return parseHeader(source);
	},
	read: readWitchArc,
});
