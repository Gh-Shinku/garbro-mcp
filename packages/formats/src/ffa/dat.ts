// Format reference: GARBro ArcFormats/Ffa/ArcBlackPackage.cs, classes `DatOpener` and `JDatOpener`,
// and the `LzssReader` they unpack with in ArcFormats/LzssStream.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const EXTENSION = "dat";
const INDEX_EXTENSION = "lst";
const NAME_SIZE = 14;
const SIZE_OFFSET = 18;
const RECORD_SIZE = 0x16;
/** The companion index is limited to a sixteen-bit entry count. */
const MAX_COUNT = 0xffff;
/** Version two keeps its index at the end of the archive itself. */
const INDEX_OFFSET_OFFSET = 0;
const V2_NAME_SIZE = 0x20;
const V2_OFFSET_OFFSET = 0x20;
const V2_SIZE_OFFSET = 0x24;
const V2_RECORD_SIZE = 0x34;
/** Version two stores payloads four bytes past the recorded offset. */
const V2_PAYLOAD_BIAS = 4;
/** Only these two extensions carry the packed header. */
const PACKED_EXTENSIONS = ["so4", "so5"];
const PACKED_HEADER_SIZE = 8;

/**
 * GARBro `DatOpener.TryOpen`. The index lives in a sibling `.lst` file whose length has to be an exact
 * multiple of the 0x16-byte record size, and the count may not exceed sixteen bits.
 *
 * Every record holds a fourteen-byte name, the payload offset and the stored size. Payloads are stored
 * as is; only `.so4` and `.so5` entries may carry a packed header, which is resolved while listing so
 * that a listing and its extraction always agree.
 */
async function readDatIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (extname(sourcePath).slice(1).toLowerCase() !== EXTENSION)
		return undefined;
	const listName = changeExtension(basename(sourcePath), INDEX_EXTENSION);
	const list = await readCompanionFile(sourcePath, listName);
	if (!list) return undefined;
	if (list.length % RECORD_SIZE !== 0) return undefined;
	const count = list.length / RECORD_SIZE;
	if (count === 0 || count > MAX_COUNT) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(list, record, NAME_SIZE);
		const offset = BigInt(list.readUInt32LE(record + NAME_SIZE));
		const size = BigInt(list.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	await resolvePackedEntries(source, entries);
	return entries;
}

/**
 * GARBro `JDatOpener.TryOpen`. The version-two archive keeps its index at the end of the file, at the
 * offset stored in the first word; the index length has to divide exactly into 0x34-byte records whose
 * names are 0x20 bytes wide and whose payload offsets are recorded four bytes low.
 */
async function readJDatIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (extname(sourcePath).slice(1).toLowerCase() !== EXTENSION)
		return undefined;
	if (source.size < BigInt(INDEX_OFFSET_OFFSET) + 4n) return undefined;
	const indexOffset = BigInt(
		(await source.readAt(BigInt(INDEX_OFFSET_OFFSET), 4)).readUInt32LE(0),
	);
	if (indexOffset >= source.size) return undefined;
	const indexSize = Number(source.size - indexOffset);
	if (indexSize === 0 || indexSize % V2_RECORD_SIZE !== 0) return undefined;
	const count = indexSize / V2_RECORD_SIZE;
	if (count > MAX_COUNT) return undefined;

	const index = await source.readAt(indexOffset, indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * V2_RECORD_SIZE;
		const name = decodeCStringField(index, record, V2_NAME_SIZE);
		const offset =
			BigInt(V2_PAYLOAD_BIAS) +
			BigInt(index.readUInt32LE(record + V2_OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(record + V2_SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	await resolvePackedEntries(source, entries);
	return entries;
}

/**
 * GARBro `DatOpener.OpenEntry`'s header test, applied while listing: an entry only counts as packed when
 * its name carries one of the two packed extensions, its size leaves room for the header, and the
 * stored length matches the declared packed length exactly.
 */
async function resolvePackedEntries(
	source: ByteSource,
	entries: readonly FixedEntry[],
): Promise<void> {
	for (const entry of entries) {
		if (entry.size <= BigInt(PACKED_HEADER_SIZE)) continue;
		const extension = extname(entry.path).slice(1).toLowerCase();
		if (!PACKED_EXTENSIONS.includes(extension)) continue;
		const header = await source.readAt(entry.offset, PACKED_HEADER_SIZE);
		const packed = header.readInt32LE(0);
		const unpacked = header.readInt32LE(4);
		if (
			BigInt(packed + PACKED_HEADER_SIZE) !== entry.size ||
			packed <= 0 ||
			unpacked <= 0
		)
			continue;
		entry.size = BigInt(unpacked);
		entry.compressed = true;
	}
}

/**
 * GARBro `DatOpener.OpenEntry`. A packed entry holds two lengths in front of its LZSS stream, which the
 * port decodes into a buffer of the declared unpacked size — the reference allocates that buffer up
 * front and leaves whatever the stream does not fill at zero.
 */
const ffaEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed) {
		return source.createReadStream(entry.offset, entry.packedSize);
	}
	const stored = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		Number(entry.packedSize) - PACKED_HEADER_SIZE,
	);
	const output = Buffer.alloc(Number(entry.size));
	const decoded = inflateLzssAll(stored, {
		maxOutputLength: output.length,
	});
	decoded.copy(output);
	return Readable.from([output]);
};

const attribution = {
	project: "GARbro",
	source: "ArcFormats/Ffa/ArcBlackPackage.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

export const ffaDatDescriptor: FormatDescriptor = {
	id: "ffa-dat",
	name: "FFA System resource archive",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const ffaDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ffaDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readDatIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDatIndex(source, sourcePath).catch(
			() => undefined,
		);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FFA DAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: ffaEntryOpener,
});

export const ffaJdatDescriptor: FormatDescriptor = {
	id: "ffa-jdat",
	name: "FFA System resource archive v2",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const ffaJdatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ffaJdatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readJDatIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readJDatIndex(source, sourcePath).catch(
			() => undefined,
		);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FFA JDAT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: ffaEntryOpener,
});
