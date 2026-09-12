// Format reference: GARbro Legacy/Witch/ArcVBD.cs
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("SOUNDDATE ", "ascii");
const COUNT_OFFSET = 0x0a;
const INDEX_OFFSET = 0x0e;
const MAXIMUM_NAME_SIZE = 0x100;

export const vbdDescriptor: FormatDescriptor = {
	id: "witch-vbd",
	name: "Witch audio archive",
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
			source: "Legacy/Witch/ArcVBD.cs",
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

async function readVbd(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Witch SOUNDDATE layout");
	}
	const records: { path: string; rawPath?: string; offset: bigint }[] = [];
	let position = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (position + 8n > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Witch VBD index is truncated");
		}
		const record = await source.readAt(position, 8);
		const offset = BigInt(record.readUInt32LE(0));
		const nameLength = record.readInt32LE(4);
		if (offset <= position || offset > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Witch VBD entry offset is invalid",
			);
		}
		if (nameLength <= 0 || nameLength > MAXIMUM_NAME_SIZE) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Witch VBD entry name length is invalid",
			);
		}
		position += 8n;
		if (position + BigInt(nameLength) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Witch VBD index is truncated");
		}
		const name = decodeCp932(await source.readAt(position, nameLength));
		position += BigInt(nameLength);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Witch VBD entry has an empty name",
			);
		}
		records.push({ ...normalizeEntryPath(name), offset });
	}
	const entries: FixedEntry[] = records.map((record, id) => {
		const nextOffset = records[id + 1]?.offset ?? source.size;
		const size = nextOffset - record.offset;
		if (!checkPlacement(record.offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Witch VBD entry points outside the archive: ${record.path}`,
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

export const vbdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: vbdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readVbd,
});
