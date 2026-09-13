// Format reference: GARBro Legacy/Libido/ArcARC.cs, class `ArcOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
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

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
/** A record is a 0x14-byte name field followed by the unpacked size, the stored size and the offset. */
const NAME_SIZE = 0x14;
const UNPACKED_SIZE_FIELD = 0x14;
const SIZE_FIELD = 0x18;
const OFFSET_FIELD = 0x1c;
const RECORD_SIZE = 0x20;
/** Name fields are obfuscated when the first one holds this byte anywhere. */
const NAME_KEY = 0xff;

export const libidoArcDescriptor: FormatDescriptor = {
	id: "libido-arc",
	name: "Libido resource archive",
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
			source: "Legacy/Libido/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `ArcOpener.TryOpen`. The archive carries no signature: the entry count sits at 0 and records of 0x20
 * bytes follow, each holding a 0x14-byte name field, the unpacked size, the stored size and the data offset.
 *
 * The reference decides once, from the *first* record's raw name field, whether the name fields are obfuscated:
 * when that field holds an `0xFF` byte anywhere, every field is exclusive-ored with `0xFF` before its name is
 * taken up to the first null. Otherwise the null is looked for directly. Either way a name is rejected when it is
 * empty or when an `0xFF` byte survives inside it, and an offset may not sit behind its own record's start — a
 * weaker bound than the payload start — while still being checked against the file.
 *
 * An entry counts as packed when its stored size differs from its unpacked size, and those payloads are decoded as
 * LZSS streams with the reference's default settings, which this port takes from the shared codec. The port marks
 * them as having an inexact size because the decoder stops at the end of the stored stream.
 */
async function readLibidoIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(
		COUNT_OFFSET,
	);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const firstField = index.subarray(0, NAME_SIZE);
	const obfuscated = firstField.includes(NAME_KEY);
	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const field = Buffer.from(index.subarray(record, record + NAME_SIZE));
		let length: number;
		if (obfuscated) {
			length = 0;
			for (; length < field.length; length += 1) {
				const value = (field[length] ?? 0) ^ NAME_KEY;
				field[length] = value;
				if (value === 0) break;
			}
		} else {
			length = field.indexOf(0);
			if (length === -1) length = field.length;
		}
		if (length <= 0) return undefined;
		const nameBytes = field.subarray(0, length);
		if (nameBytes.includes(NAME_KEY)) return undefined;
		const name = decodeCp932(nameBytes);
		if (name.length === 0) return undefined;
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (
			offset <= BigInt(INDEX_OFFSET + position) ||
			!checkPlacement(offset, storedSize, source.size)
		)
			return undefined;
		const packed = storedSize !== unpackedSize;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
			encrypted: obfuscated,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
		position += RECORD_SIZE;
	}
	return entries;
}

/** GARBro `ArcOpener.OpenEntry`: packed payloads are plain LZSS streams with default settings. */
async function openLibidoEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "LZSS entry"),
	);
	return Readable.from([inflateLzssAll(stored)]);
}

export const libidoArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: libidoArcDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLibidoIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLibidoIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Libido ARC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openLibidoEntry,
});
