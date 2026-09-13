// Format reference: GARbro ArcFormats/Adobe/ArcAIR.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createRawInflateStream, inflateRawBuffer } from "@garbro-mcp/codecs";
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
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const INDEX_OFFSET_SIZE = 4;
/** GARbro refuses archives larger than this. */
const MAX_ARCHIVE_SIZE = 0x40000000n;
const MAX_INDEX_SIZE = 0x100000;
/** First bytes of the inflated index. */
const INDEX_MAGIC = Buffer.from([0x0a, 0x0b, 0x01]);
const NAME_MARKER = Buffer.from([0x09, 0x05, 0x01]);
const INTEGER_MARKER = 0x04;
const NAME_FLAG = 1;
const MAX_NAME_LENGTH = 0x80;

export const airDescriptor: FormatDescriptor = {
	id: "adobe-air",
	name: "Adobe AIR resource archive",
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
			source: "ArcFormats/Adobe/ArcAIR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `ReadInteger`: an unsigned variable-length integer where every byte but the last carries
 * seven bits and sets the high bit.
 */
function readInteger(
	index: Buffer,
	cursor: { position: number },
): number | undefined {
	const read = (): number | undefined => {
		if (cursor.position >= index.length) return undefined;
		const value = index[cursor.position];
		cursor.position += 1;
		return value;
	};
	let value = read();
	if (value === undefined) return undefined;
	if (value < 0x80) return value;
	value = (value & 0x7f) << 7;
	let byte = read();
	if (byte === undefined) return undefined;
	if (byte < 0x80) return (value | byte) >>> 0;
	value = ((value | (byte & 0x7f)) << 7) >>> 0;
	byte = read();
	if (byte === undefined) return undefined;
	if (byte < 0x80) return (value | byte) >>> 0;
	value = ((value | (byte & 0x7f)) << 8) >>> 0;
	const last = read();
	if (last === undefined) return undefined;
	return (value | last) >>> 0;
}

/**
 * GARBro `DatOpener.TryOpen`. The archive starts with a big-endian offset to a raw-deflate index
 * that begins with `0a 0b 01`. Records follow as a flagged name length, the UTF-8 name, the
 * `09 05 01` marker, and two length-prefixed integers behind `04` markers for the data offset and the
 * compressed size. A zero name length closes the index.
 *
 * Payloads are raw-deflate streams, so the extracted size is only known after decoding: entries keep
 * the stored size and are flagged as not having an exact size.
 */
async function readAirIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET_SIZE)) return undefined;
	if (source.size > MAX_ARCHIVE_SIZE) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET_SIZE);
	const indexOffset = BigInt(header.readUInt32BE(0));
	if (indexOffset === 0n || indexOffset >= source.size) return undefined;
	const indexSize = source.size - indexOffset;
	if (indexSize > BigInt(MAX_INDEX_SIZE)) return undefined;
	const raw = await source.readAt(indexOffset, Number(indexSize));
	let index: Buffer;
	try {
		index = await inflateRawBuffer(raw);
	} catch {
		return undefined;
	}
	if (!index.subarray(0, INDEX_MAGIC.length).equals(INDEX_MAGIC))
		return undefined;

	const cursor = { position: INDEX_MAGIC.length };
	const entries: FixedEntry[] = [];
	for (;;) {
		if (cursor.position >= index.length) return undefined;
		const lengthByte = index[cursor.position];
		cursor.position += 1;
		if (lengthByte === undefined || (lengthByte & NAME_FLAG) === 0)
			return undefined;
		const nameLength = lengthByte >> 1;
		if (nameLength === 0) break;
		if (nameLength > MAX_NAME_LENGTH) return undefined;
		if (cursor.position + nameLength > index.length) return undefined;
		const name = index
			.subarray(cursor.position, cursor.position + nameLength)
			.toString("utf8");
		cursor.position += nameLength;
		if (
			!index
				.subarray(cursor.position, cursor.position + NAME_MARKER.length)
				.equals(NAME_MARKER)
		)
			return undefined;
		cursor.position += NAME_MARKER.length;
		if (index[cursor.position] !== INTEGER_MARKER) return undefined;
		cursor.position += 1;
		const offset = readInteger(index, cursor);
		if (offset === undefined) return undefined;
		if (index[cursor.position] !== INTEGER_MARKER) return undefined;
		cursor.position += 1;
		const size = readInteger(index, cursor);
		if (size === undefined) return undefined;
		if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
			return undefined;
		const entry: FixedEntry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset: BigInt(offset),
			size: BigInt(size),
			compressed: true,
		});
		entry.sizeKnown = false;
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARbro `DatOpener.OpenEntry`: every payload is a raw-deflate stream. */
const airEntryOpener: FixedEntryOpener = async (source, entry) =>
	createRawInflateStream(
		source.createReadStream(entry.offset, entry.packedSize),
	);

export const airFormat: ArchiveFormat = defineFixedArchive({
	descriptor: airDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAirIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAirIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Adobe AIR layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: airEntryOpener,
});
