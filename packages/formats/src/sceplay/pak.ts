// Format reference: GARbro Legacy/Sceplay/ArcPAK.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("pak\0", "binary");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const MAXIMUM_NAME_LENGTH = 0x18;
const ABSENT_OFFSET = 0xffffffffn;

export const sceplayPakDescriptor: FormatDescriptor = {
	id: "sceplay-pak",
	name: "Sceplay engine resource archive",
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
			source: "Legacy/Sceplay/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	return isSaneCount(count) ? count : undefined;
}

async function readSceplayPak(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Sceplay PAK layout");
	}
	const records: { path: string; rawPath?: string }[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Sceplay PAK index is truncated",
			);
		}
		const { value: name, end } = await readCStringAt(
			source,
			position,
			MAXIMUM_NAME_LENGTH,
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Sceplay PAK entry has an empty name",
			);
		}
		position = end;
		records.push(
			normalizeEntryPath(name) as { path: string; rawPath?: string },
		);
	}
	if (position + BigInt(count * 8) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Sceplay PAK index is truncated");
	}
	const table = await source.readAt(position, count * 8);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const size = BigInt(table.readUInt32LE(id * 4));
		const offset = BigInt(table.readUInt32LE(count * 4 + id * 4));
		if (offset === ABSENT_OFFSET) continue;
		const record = records[id];
		if (!record) continue;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Sceplay PAK entry points outside the archive: ${record.path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: record.path,
				...(record.rawPath === undefined ? {} : { rawPath: record.rawPath }),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Sceplay PAK archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const sceplayPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sceplayPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readSceplayPak,
});
