// Format reference: GARBro ArcFormats/CsWare/ArcARC2.cs
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

const SIGNATURE = Buffer.from("arc2", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET_OFFSET = 8;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;
const SIZE_OFFSET = 0x10;
const OFFSET_OFFSET = 0x14;
const KEY1_OFFSET = 0x18;
const KEY2_OFFSET = 0x1c;
const WORD_SIZE = 4;

export const arc2Descriptor: FormatDescriptor = {
	id: "csware-arc2",
	name: "C's ware resource archive",
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
			source: "ArcFormats/CsWare/ArcARC2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Arc2Opener.TryOpen`. The `arc2` signature is followed by a record count at 4 and the index
 * offset at 8. Records are 0x20 bytes with a 0x10-byte name, the stored size, the data offset, and
 * two 32-bit keys. GARbro skips repeated names, keeping only the first record of each.
 *
 * Payloads whose keys are not both zero are transformed with a Fibonacci-style word chain: each
 * 32-bit word has the sum of the two keys subtracted, and the pair then advances by one step.
 */
async function readArc2Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	if (indexOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const seen = new Set<string>();
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (seen.has(name)) continue;
		seen.add(name);
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		const key1 = index.readUInt32LE(record + KEY1_OFFSET) >>> 0;
		const key2 = index.readUInt32LE(record + KEY2_OFFSET) >>> 0;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size,
			encrypted: (key1 | key2) !== 0,
		});
		if ((key1 | key2) !== 0) entry.metadata = { key1, key2 };
		entries.push(entry);
	}
	return entries;
}

/** GARbro `Arc2Opener.OpenEntry`: subtract a Fibonacci-style key chain from every 32-bit word. */
const arc2EntryOpener: FixedEntryOpener = async (source, entry) => {
	const key1 = entry.metadata?.key1;
	const key2 = entry.metadata?.key2;
	if (typeof key1 !== "number" || typeof key2 !== "number")
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	let previous = key1 >>> 0;
	let current = key2 >>> 0;
	for (
		let position = 0;
		position + WORD_SIZE <= payload.length;
		position += WORD_SIZE
	) {
		const keySum = (previous + current) >>> 0;
		payload.writeUInt32LE(
			(payload.readUInt32LE(position) - keySum) >>> 0,
			position,
		);
		previous = current;
		current = keySum;
	}
	return Readable.from([payload]);
};

export const arc2Format: ArchiveFormat = defineFixedArchive({
	descriptor: arc2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArc2Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readArc2Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid C's ware ARC2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: arc2EntryOpener,
});
