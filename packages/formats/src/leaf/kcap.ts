// Format reference: GARbro "ArcFormats/Leaf/ArcPAK.cs", class `KcapOpener` and its entry structures.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
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
} from "../shared/fixed-archive.js";

const KCAP_MARKER = "KCAP";
const NAME_SIZE = 0x18;
const HEADER_SIZE = 0x38;
/** The packed entries of every version start with an eight byte payload header. */
const PACK_HEADER_SIZE = 8;

interface KcapLayout {
	version: number;
	recordSize: number;
	indexOffset: number;
	nameOffset: number;
	offsetField: number;
	sizeField: number;
	/** Version zero has no packed flag and always stores LZSS streams. */
	packedField: number | undefined;
}

const LAYOUTS: readonly KcapLayout[] = [
	{
		version: 0,
		recordSize: 0x20,
		indexOffset: 8,
		nameOffset: 0,
		offsetField: 0x18,
		sizeField: 0x1c,
		packedField: undefined,
	},
	{
		version: 1,
		recordSize: 0x24,
		indexOffset: 8,
		nameOffset: 4,
		offsetField: 0x1c,
		sizeField: 0x20,
		packedField: 0,
	},
	{
		version: 2,
		recordSize: 0x2c,
		indexOffset: 0x10,
		nameOffset: 4,
		offsetField: 0x24,
		sizeField: 0x28,
		packedField: 0,
	},
];

interface KcapEntry {
	name: string;
	offset: bigint;
	size: number;
	packed: boolean;
}

/** Probes the four index layouts that the reference accepts. */
function resolveLayout(
	header: Buffer,
): { layout: KcapLayout; count: number } | undefined {
	const first = (field: number): number => header.readUInt32LE(field);
	const count = header.readInt32LE(4);
	if (isSaneCount(count)) {
		if (count * 0x20 + 8 === first(0x20))
			return { layout: LAYOUTS[0] as KcapLayout, count };
		if (count * 0x24 + 8 === first(0x24))
			return { layout: LAYOUTS[1] as KcapLayout, count };
	}
	const second = header.readInt32LE(8);
	if (isSaneCount(second) && second * 0x24 + 0xc === first(0x28))
		return {
			layout: { ...(LAYOUTS[1] as KcapLayout), indexOffset: 0xc },
			count: second,
		};
	const third = header.readInt32LE(12);
	if (isSaneCount(third) && third * 0x2c + 0x10 === first(0x34))
		return { layout: LAYOUTS[2] as KcapLayout, count: third };
	return undefined;
}

async function readKcapEntries(
	source: ByteSource,
): Promise<KcapEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.toString("latin1", 0, 4) !== KCAP_MARKER) return undefined;
	const resolved = resolveLayout(header);
	if (!resolved) return undefined;
	const { layout, count } = resolved;
	const indexSize = count * layout.recordSize;
	if (BigInt(layout.indexOffset) + BigInt(indexSize) > source.size)
		return undefined;
	const index = await source.readAt(BigInt(layout.indexOffset), indexSize);
	const entries: KcapEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = id * layout.recordSize;
		const name = decodeCStringField(index, base + layout.nameOffset, NAME_SIZE);
		const offset = BigInt(index.readUInt32LE(base + layout.offsetField));
		const size = index.readUInt32LE(base + layout.sizeField);
		// Records without a payload are skipped, exactly like the reference.
		if (size === 0) continue;
		if (!checkPlacement(offset, BigInt(size), source.size)) return undefined;
		entries.push({
			name,
			offset,
			size,
			packed:
				layout.packedField === undefined
					? true
					: index.readInt32LE(base + layout.packedField) !== 0,
		});
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const leafKcapDescriptor: FormatDescriptor = {
	id: "leaf-kcap",
	name: "Leaf resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/Leaf/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafKcapFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafKcapDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(KCAP_MARKER, "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readKcapEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readKcapEntries(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KCAP index");
		const fixed: FixedEntry[] = entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
				packedSize: BigInt(entry.size),
				compressed: entry.packed,
			});
			// Packed entries declare their unpacked size inside the payload header.
			return entry.packed ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (entry.compressed !== true || stored.length <= PACK_HEADER_SIZE)
			return Readable.from([stored]);
		return Readable.from([inflateLzssAll(stored.subarray(PACK_HEADER_SIZE))]);
	},
});
