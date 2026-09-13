// Format reference: GARBro ArcFormats/Otemoto/ArcTLZ.cs, class `TlzOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
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
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("TLZ1", "ascii");
const INDEX_OFFSET_FIELD = 4;
const COUNT_OFFSET = 0x0c;
const HEADER_SIZE = 0x10;
const RECORD_HEADER_SIZE = 0x10;
const NAME_LENGTH_LIMIT = 0x100;

export const tlzDescriptor: FormatDescriptor = {
	id: "otemoto-tlz",
	name: "Otemoto resource archive",
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
			source: "ArcFormats/Otemoto/ArcTLZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readTlzIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	let indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset >= source.size) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + BigInt(RECORD_HEADER_SIZE) > source.size)
			return undefined;
		const record = await source.readAt(indexOffset, RECORD_HEADER_SIZE);
		const unpackedSize = BigInt(record.readUInt32LE(0));
		const storedSize = BigInt(record.readUInt32LE(4));
		const offset = BigInt(record.readUInt32LE(8));
		const nameLength = record.readUInt32LE(0x0c);
		if (nameLength === 0 || nameLength > NAME_LENGTH_LIMIT) return undefined;
		const nameOffset = indexOffset + BigInt(RECORD_HEADER_SIZE);
		if (nameOffset + BigInt(nameLength) > source.size) return undefined;
		const name = decodeCStringField(
			await source.readAt(nameOffset, nameLength),
			0,
			nameLength,
		);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed = unpackedSize !== storedSize;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
		indexOffset = nameOffset + BigInt(nameLength);
	}
	return entries;
}

async function openTlzEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	return Readable.from([
		inflateLzssAll(
			await source.readAt(
				entry.offset,
				bigintToBufferLength(entry.packedSize, "TLZ LZSS entry"),
			),
		),
	]);
}

export const tlzFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tlzDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTlzIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readTlzIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Otemoto TLZ layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openTlzEntry,
});
