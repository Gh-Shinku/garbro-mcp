// Format reference: GARBro ArcFormats/HSP/ArcDPM.cs, classes `DpmOpener` and `DpmArchive`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("DPMX", "ascii");
const HEADER_SIZE = 0x10;
const DATA_BASE_FIELD = 4;
const COUNT_FIELD = 8;
const INDEX_OFFSET_FIELD = 0xc;
/** Index records hold a 0x10 byte name, a key and an offset and size pair. */
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x20;
const KEY_OFFSET = NAME_SIZE;
const ENTRY_OFFSET_FIELD = NAME_SIZE + 4;
const ENTRY_SIZE_FIELD = NAME_SIZE + 8;
/** Standalone archives use these seeds; an embedded archive derives them from its executable key. */
const SEED_FIRST = 0xaa;
const SEED_SECOND = 0x55;
const KEY_SEED_FIRST = 0x5a;
const KEY_SEED_SECOND = 0xa5;

function readName(bytes: Buffer): string {
	const end = bytes.indexOf(0);
	return decodeCp932(end === -1 ? bytes : bytes.subarray(0, end));
}

/**
 * GARbro `DpmArchive.DecryptEntry2`. The key seeds two bytes that then feed a running sum, so every byte
 * depends on the cipher byte in its own position. Entries without a key are stored as they are.
 */
export function decryptDpmEntry(data: Buffer, key: number): Buffer {
	const output = Buffer.from(data);
	const seedFirst =
		(SEED_FIRST + (((key >>> 16) ^ ((key + KEY_SEED_FIRST) >>> 0)) & 0xff)) &
		0xff;
	const seedSecond =
		(SEED_SECOND +
			(((key >>> 24) ^ (((key >>> 8) + KEY_SEED_SECOND) >>> 0)) & 0xff)) &
		0xff;
	let value = 0;
	for (let index = 0; index < output.length; index += 1) {
		const step = ((seedFirst ^ (output[index] ?? 0)) - seedSecond) & 0xff;
		value = (value + step) & 0xff;
		output[index] = value;
	}
	return output;
}

/**
 * GARbro `DpmOpener.TryOpen` for a standalone archive. Behind the signature sit the base the entry offsets
 * are relative to, the entry count and the position of the index, which follows the payloads at the end of
 * the file.
 */
async function readDpmIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(
		HEADER_SIZE + header.readUInt32LE(INDEX_OFFSET_FIELD),
	);
	const dataBase = BigInt(header.readUInt32LE(DATA_BASE_FIELD));
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(indexOffset, count * RECORD_SIZE),
	);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = readName(index.subarray(record, record + NAME_SIZE));
		const key = index.readUInt32LE(record + KEY_OFFSET);
		const offset =
			BigInt(index.readUInt32LE(record + ENTRY_OFFSET_FIELD)) + dataBase;
		const size = BigInt(index.readUInt32LE(record + ENTRY_SIZE_FIELD));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: key !== 0,
				metadata: { key },
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const dpmDescriptor: FormatDescriptor = {
	id: "hsp-dpm",
	name: "Hot Soup Processor resource archive",
	extensions: ["dpm", "bin", "dat"],
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
			source: "ArcFormats/HSP/ArcDPM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const dpmFormat = defineFixedArchive({
	descriptor: dpmDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDpmIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDpmIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid HSP DPM layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	/** `DpmOpener.OpenEntry`: only entries with a key are decoded, everything else is stored as it is. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		const key = Number(entry.metadata?.key ?? 0);
		return Readable.from([key === 0 ? stored : decryptDpmEntry(stored, key)]);
	},
});
