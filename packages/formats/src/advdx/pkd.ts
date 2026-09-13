// Format reference: GARbro ArcFormats/AdvDx/ArcPKD.cs
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
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PACK", "ascii");
const COUNT_OFFSET = 4;
const KEY_OFFSET = 0x87;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x80;
const RECORD_SIZE = NAME_SIZE + 8;

export const advdxPkdDescriptor: FormatDescriptor = {
	id: "advdx-pkd",
	name: "AdvDX engine resource archive",
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
			source: "ArcFormats/AdvDx/ArcPKD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface PkdIndex {
	key: number;
	entries: FixedEntry[];
}

/**
 * GARbro `PkdOpener.TryOpen`. The index is XOR-encrypted with the key byte stored at 0x87; the same
 * key decrypts every entry payload, and a zero key leaves both the index and the payloads intact.
 */
async function readPkdIndex(source: ByteSource): Promise<PkdIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (source.size < BigInt(KEY_OFFSET + 1)) return undefined;
	const key = (await source.readAt(BigInt(KEY_OFFSET), 1))[0] ?? 0;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ key;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
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

const pkdEntryOpener: FixedEntryOpener = async (source, entry) => {
	const raw = await source.readAt(entry.offset, Number(entry.size));
	const key = entry.metadata?.key;
	if (typeof key !== "number" || key === 0) return Readable.from([raw]);
	const decrypted = Buffer.from(raw);
	for (let position = 0; position < decrypted.length; position += 1)
		decrypted[position] = (decrypted[position] ?? 0) ^ key;
	return Readable.from([decrypted]);
};

export const advdxPkdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: advdxPkdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPkdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readPkdIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AdvDX PKD layout");
		const entries = index.entries.map((entry) => ({
			...entry,
			metadata: { ...entry.metadata, key: index.key },
		}));
		return {
			entries,
			metadata: { entryCount: entries.length, key: index.key },
		};
	},
	openEntry: pkdEntryOpener,
});
