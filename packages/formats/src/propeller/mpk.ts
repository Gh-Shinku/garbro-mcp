// Format reference: GARbro ArcFormats/Propeller/ArcMPK.cs
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

const INDEX_OFFSET_OFFSET = 0;
const COUNT_OFFSET = 4;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;
const SCRIPT_XOR_KEY = 0x88;
const SCRIPT_EXTENSION = "msc";

export const propellerMpkDescriptor: FormatDescriptor = {
	id: "propeller-mpk",
	name: "Propeller resources archive",
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
			source: "ArcFormats/Propeller/ArcMPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface MpkIndex {
	key: number;
	entries: FixedEntry[];
}

/**
 * GARbro `MpkOpener.TryOpen`: the last byte of the first name field doubles as the XOR key for the
 * whole index. A leading backslash is skipped before the name is decoded.
 */
async function readMpkIndex(source: ByteSource): Promise<MpkIndex | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	const count = header.readInt32LE(COUNT_OFFSET);
	if (indexOffset < 8n || indexOffset >= source.size) return undefined;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(indexSize) > source.size - indexOffset) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const key = index[NAME_SIZE - 1] ?? 0;
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ key;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameOffset = index[record] === 0x5c ? 1 : 0;
		const name = decodeCStringField(
			index,
			record + nameOffset,
			NAME_SIZE - nameOffset,
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE));
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

/** GARbro `MpkOpener.OpenEntry`: `*.msc` payloads starting with 0x88 are XOR-obfuscated. */
const mpkEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (sourceExtension(entry.path) !== SCRIPT_EXTENSION || entry.size === 0n)
		return source.createReadStream(entry.offset, entry.size);
	const first = (await source.readAt(entry.offset, 1))[0] ?? 0;
	if (first !== SCRIPT_XOR_KEY)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = (payload[position] ?? 0) ^ SCRIPT_XOR_KEY;
	return Readable.from([payload]);
};

export const propellerMpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: propellerMpkDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMpkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readMpkIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Propeller MPK layout");
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { ...entry.metadata, key: index.key },
		}));
		return {
			entries,
			metadata: { entryCount: entries.length, key: index.key },
		};
	},
	openEntry: mpkEntryOpener,
});
