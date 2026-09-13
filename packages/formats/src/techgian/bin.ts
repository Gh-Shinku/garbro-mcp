// Format reference: GARBro ArcFormats/TechGian/ArcBIN.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
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

const SIGNATURE = Buffer.from("RFIL", "ascii");
const COUNT_OFFSET = 8;
const ENCRYPTION_FLAG_OFFSET = 12;
/** The index is XORed with a C runtime random stream when this word equals 1234. */
const ENCRYPTED_INDEX_FLAG = 1234;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x40;
const NAME_SIZE = 0x30;
const OFFSET_FIELD_OFFSET = 0x34;
const SIZE_FIELD_OFFSET = 0x38;
const METHOD_FIELD_OFFSET = 0x3c;
/** Payload XOR key. */
const DATA_KEY = 0x7f;
/** Method 2 encrypts one byte per hundred plus one; method 4 at most the first kilobyte. */
const PERCENT_DIVISOR = 100;
const METHOD_4_LIMIT = 1024;
const METHOD_FULL = 1;
const METHOD_PERCENT = 2;
const METHOD_PREFIX = 4;

export const techgianBinDescriptor: FormatDescriptor = {
	id: "techgian-bin",
	name: "Tech Gian archive",
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
			source: "ArcFormats/TechGian/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `CRuntimeRandomGenerator`: the Microsoft C runtime linear congruential generator. */
class CRuntimeRandom {
	#seed = 0;

	rand(): number {
		this.#seed = (Math.imul(this.#seed, 214013) + 2531011) >>> 0;
		return (this.#seed >>> 16) & 0x7fff;
	}
}

/**
 * GARBro `BinOpener.TryOpen`. The `RFIL` archive keeps a record count at 8 and a second word at 12
 * that marks the index as XORed with a C runtime random stream seeded with zero. Each 0x40-byte
 * record holds a CP932 name, an offset, a size, and a payload encryption method.
 */
async function readBinIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const isEncrypted =
		header.readInt32LE(ENCRYPTION_FLAG_OFFSET) === ENCRYPTED_INDEX_FLAG;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	if (isEncrypted) {
		const random = new CRuntimeRandom();
		for (let position = 0; position < index.length; position += 1)
			index[position] = (index[position] ?? 0) ^ random.rand();
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameField = index.subarray(record, record + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD_OFFSET));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD_OFFSET));
		const method = index.readInt32LE(record + METHOD_FIELD_OFFSET);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
		});
		entry.metadata = { encryptionMethod: method, indexEncrypted: isEncrypted };
		entries.push(entry);
	}
	return entries;
}

/**
 * GARBro `BinOpener.OpenEntry`. Methods `1`, `2`, and `4` XOR the payload with 0x7F: entirely, one
 * byte per hundred plus one, or at most the first kilobyte respectively. Every other method is
 * extracted verbatim.
 */
async function openBinEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const method =
		typeof entry.metadata?.encryptionMethod === "number"
			? entry.metadata.encryptionMethod
			: 0;
	if (
		method !== METHOD_FULL &&
		method !== METHOD_PERCENT &&
		method !== METHOD_PREFIX
	)
		return source.createReadStream(entry.offset, entry.size);
	const data = await source.readAt(entry.offset, Number(entry.size));
	let length = data.length;
	if (method === METHOD_PERCENT) {
		length =
			data.length === 0
				? 0
				: Math.trunc((data.length - 1) / PERCENT_DIVISOR) + 1;
	} else if (method === METHOD_PREFIX) {
		length = Math.min(METHOD_4_LIMIT, data.length);
	}
	for (let position = 0; position < length; position += 1)
		data[position] = (data[position] ?? 0) ^ DATA_KEY;
	return Readable.from([data]);
}

export const techgianBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: techgianBinDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readBinIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readBinIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid RFIL archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openBinEntry,
});
