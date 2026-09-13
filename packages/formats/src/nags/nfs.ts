// Format reference: GARbro ArcFormats/Nags/ArcNFS.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x18;
const RECORD_SIZE = 0x20;
const SCRIPT_EXTENSION = "scb";

export const nfsDescriptor: FormatDescriptor = {
	id: "nags-nfs",
	name: "NAGS engine resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Nags/ArcNFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface NfsIndex {
	key: number;
	entries: FixedEntry[];
}

/**
 * GARbro `NfsOpener.TryOpen`. The record count is also the XOR key for the index; the last 32-bit
 * word of the first record must decrypt to zero and offsets are relative to the end of the index.
 */
async function readNfsIndex(source: ByteSource): Promise<NfsIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const key = count & 0xff;
	const repeated = (key | (key << 8) | (key << 16) | (key << 24)) >>> 0;
	// GARbro reads the first record's offset field, which is stored with zero XORed in, so a
	// correctly encrypted index leaves the repeated key byte there.
	if ((index.readUInt32LE(NAME_SIZE) ^ repeated) !== 0) return undefined;
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ key;
	const baseOffset = BigInt(INDEX_OFFSET + indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0) return undefined;
		const offset = baseOffset + BigInt(index.readUInt32LE(record + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: key !== 0,
			}),
		);
	}
	return { key, entries };
}

/** GARbro `NfsOpener.OpenEntry`: `*.scb` scripts are stored bitwise inverted. */
const nfsEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (sourceExtension(entry.path) !== SCRIPT_EXTENSION || entry.size === 0n)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = ~(payload[position] ?? 0) & 0xff;
	return Readable.from([payload]);
};

export const nfsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nfsDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readNfsIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readNfsIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NAGS NFS layout");
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { ...entry.metadata, key: index.key },
		}));
		return {
			entries,
			metadata: { entryCount: entries.length, key: index.key },
		};
	},
	openEntry: nfsEntryOpener,
});
