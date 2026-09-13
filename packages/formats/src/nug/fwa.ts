// GARBro ArcFormats/Nug/ArcDAT.cs, FwaOpener.
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
const SIGNATURE = Buffer.from("1AWF", "ascii"),
	INDEX_BASE = 0x10,
	RECORD_MIN = 0x40;
const SCWF = Buffer.from("SCWF", "ascii"),
	CCWF = Buffer.from("CCWF", "ascii"),
	HEADER = 0x20;
export const fwaDescriptor: FormatDescriptor = {
	id: "nug-fwa",
	name: "Frontwing resource archive",
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
			source: "Legacy/Nug/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};
async function index(source: ByteSource): Promise<FixedEntry[] | undefined> {
	if (source.size < 0x14n) return undefined;
	const h = await source.readAt(0n, 0x14);
	if (!h.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const count = h.readInt32LE(0xc);
	if (!isSaneCount(count)) return undefined;
	let pos = BigInt(h.readUInt32LE(0x10) + count * 4);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id++) {
		if (pos + BigInt(RECORD_MIN) > source.size) return undefined;
		const r = await source.readAt(pos, RECORD_MIN);
		const span = r.readUInt32LE(0);
		if (span < RECORD_MIN || pos + BigInt(span) > source.size) return undefined;
		const size = BigInt(r.readUInt32LE(8)),
			offset = BigInt(r.readUInt32LE(4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(decodeCStringField(r, 0x10, 0x30)),
				offset,
				size,
			}),
		);
		pos += BigInt(span);
	}
	return entries;
}
async function open(source: ByteSource, entry: FixedEntry): Promise<Readable> {
	if (entry.size <= BigInt(HEADER))
		return source.createReadStream(entry.offset, entry.size);
	const h = await source.readAt(entry.offset, HEADER);
	if (h.subarray(0, 4).equals(CCWF))
		return source.createReadStream(
			entry.offset + BigInt(HEADER),
			BigInt(h.readUInt32LE(0x10)),
		);
	if (!h.subarray(0, 4).equals(SCWF))
		return source.createReadStream(entry.offset, entry.size);
	const size = entry.size - BigInt(HEADER);
	return Readable.from([
		inflateLzssAll(
			await source.readAt(
				entry.offset + BigInt(HEADER),
				bigintToBufferLength(size, "FWA LZSS entry"),
			),
		),
	]);
}
export const fwaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fwaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(s) {
		return (await index(s)) !== undefined;
	},
	async read(s) {
		const entries = await index(s);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FWA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: open,
});
