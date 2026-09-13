// Format reference: GARBro ArcFormats/StudioSakura/ArcDAT.cs, class `DatOpener`.
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
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
const INDEX_OFFSET = 0x20,
	RECORD_SIZE = 0x110,
	NAME_SIZE = 0x100,
	SIZE_FIELD = 0x100,
	OFFSET_FIELD = 0x104,
	HEADER_SIZE = 0x24;
const MARKER = Buffer.from("ACMPRS03", "ascii");
export const studioSakuraDatDescriptor: FormatDescriptor = {
	id: "studio-sakura-dat",
	name: "Studio Sakura resource archive",
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
			source: "ArcFormats/StudioSakura/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};
async function readIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < 4n) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	if (BigInt(dataOffset) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const rawName = decodeCStringField(index, record, NAME_SIZE);
		if (!rawName.trim()) return undefined;
		const packed = sourceExtension(rawName) === "pr3";
		const name = packed ? rawName.replace(/\.[^.]*$/, "") : rawName;
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (offset < BigInt(dataOffset) || offset > source.size) return undefined;
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
async function openEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed || entry.packedSize < BigInt(HEADER_SIZE))
		return source.createReadStream(entry.offset, entry.packedSize);
	const header = await source.readAt(entry.offset, HEADER_SIZE);
	if (!header.subarray(0, MARKER.length).equals(MARKER))
		return source.createReadStream(entry.offset, entry.packedSize);
	const packedSize = BigInt(header.readUInt32LE(0x14));
	if (packedSize > entry.packedSize - BigInt(HEADER_SIZE))
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Studio Sakura packed entry exceeds its stored span",
		);
	return Readable.from([
		inflateLzssAll(
			await source.readAt(
				entry.offset + BigInt(HEADER_SIZE),
				bigintToBufferLength(packedSize, "Studio Sakura LZSS entry"),
			),
		),
	]);
}
export const studioSakuraDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: studioSakuraDatDescriptor,
	async detect(source: ByteSource) {
		return (await readIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio Sakura DAT layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry,
});
