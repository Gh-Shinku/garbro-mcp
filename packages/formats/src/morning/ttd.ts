// Format reference: GARBro ArcFormats/Morning/ArcTTD.cs, class `TtdOpener`.
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

const SIGNATURE = Buffer.from(".FRC", "ascii");
const KEY_OFFSET = 4;
const COUNT_OFFSET = 0x0c;
const INDEX_OFFSET = 0x14;
const RECORD_SIZE = 0x2c;
const NAME_OFFSET = 12;
const NAME_SIZE = 0x20;
const PACKED_MARKER = Buffer.from("DSFF", "ascii");
const PACKED_HEADER_SIZE = 8;
const LZSS_FRAME_INIT_POSITION = 0xff0;

export const morningTtdDescriptor: FormatDescriptor = {
	id: "morning-ttd",
	name: "Morning resource archive",
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
			source: "ArcFormats/Morning/ArcTTD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function decryptIndex(index: Buffer, key: number): void {
	for (let offset = 0; offset + 4 <= index.length; offset += 4)
		index.writeUInt32LE(index.readUInt32LE(offset) ^ key, offset);
}

async function readTtdIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (
		!isSaneCount(count) ||
		BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size
	)
		return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	decryptIndex(index, header.readUInt32LE(KEY_OFFSET));
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record + NAME_OFFSET, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const size = BigInt(index.readUInt32LE(record));
		const offset = BigInt(index.readUInt32LE(record + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const packed =
			size > BigInt(PACKED_HEADER_SIZE) &&
			(await source.readAt(offset, 4)).equals(PACKED_MARKER);
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

async function openTtdEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	const packedSize = entry.size - BigInt(PACKED_HEADER_SIZE);
	return Readable.from([
		inflateLzssAll(
			await source.readAt(
				entry.offset + BigInt(PACKED_HEADER_SIZE),
				bigintToBufferLength(packedSize, "TTD LZSS entry"),
			),
			{ frameInitPosition: LZSS_FRAME_INIT_POSITION },
		),
	]);
}

export const morningTtdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: morningTtdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readTtdIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readTtdIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Morning TTD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openTtdEntry,
});
