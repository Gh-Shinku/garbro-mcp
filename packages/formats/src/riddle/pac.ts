// GARBro ArcFormats/RiddleSoft/ArcPAC.cs, PacOpener.
import { inflateRiddleCmp } from "@garbro-mcp/codecs";
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
const SIG = Buffer.from("PAC1"),
	REC = 0x20,
	INDEX = 8,
	CMP = Buffer.from("CMP1");
export const riddlePacDescriptor: FormatDescriptor = {
	id: "riddle-pac1",
	name: "Riddle Soft resource archive",
	extensions: ["pac"],
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
			source: "ArcFormats/RiddleSoft/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};
async function read(source: ByteSource): Promise<FixedEntry[] | undefined> {
	if (source.size < 8n) return undefined;
	const h = await source.readAt(0n, 8);
	if (!h.subarray(0, 4).equals(SIG)) return undefined;
	const count = h.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;
	let offset = BigInt(INDEX + count * REC);
	if (offset > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX), count * REC);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id++) {
		const r = id * REC,
			name = decodeCStringField(index, r, 0x10),
			storedSize = BigInt(index.readUInt32LE(r + 0x10));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed =
			sourceExtension(name) === "scp" &&
			storedSize > 12n &&
			index.subarray(r + 0x14, r + 0x18).equals(CMP);
		const size = packed ? BigInt(index.readUInt32LE(r + 0x18)) : storedSize;
		const e = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
			packedSize: storedSize,
			compressed: packed,
			...(sourceExtension(name) === "scp"
				? { metadata: { inferredType: "script" } }
				: {}),
		});
		entries.push(e);
		offset += storedSize;
	}
	return entries;
}
export const riddlePacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: riddlePacDescriptor,
	detection: { signatures: [{ bytes: SIG }] },
	async detect(s) {
		return (await read(s)) !== undefined;
	},
	async read(s) {
		const entries = await read(s);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PAC1 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(s, e: FixedEntry): Promise<Readable> {
		if (!e.compressed) return s.createReadStream(e.offset, e.packedSize);
		const h = await s.readAt(e.offset, 12);
		if (!h.subarray(0, 4).equals(CMP))
			return s.createReadStream(e.offset, e.packedSize);
		return Readable.from([
			inflateRiddleCmp(
				await s.readAt(
					e.offset + 12n,
					bigintToBufferLength(e.packedSize - 12n, "CMP1 entry"),
				),
				h.readInt32LE(4),
			),
		]);
	},
});
