// Format reference: GARbro ArcFormats/RPM/ArcARC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import {
	guessRpmScheme,
	type RpmEncryptionScheme,
	type RpmIndexRecord,
	readRpmIndex,
} from "./index-reader.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
const INDEX_OFFSET = 8;
/** GARbro `MinEntryLength`: the narrowest possible record, a 0x18 name field plus three ints. */
const MIN_ENTRY_LENGTH = 0x24;
/** GARbro tries the widest scheme first. */
const POSSIBLE_NAME_SIZES = [0x20, 0x18] as const;
const INSTDATA_SCHEME = "inst";
const INSTDATA_NAME = "instdata.arc";

export const rpmArcDescriptor: FormatDescriptor = {
	id: "rpm-arc",
	name: "RPM engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/RPM/ArcARC.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

interface RpmArcIndex {
	count: number;
	isCompressed: boolean;
	scheme: RpmEncryptionScheme;
	records: RpmIndexRecord[];
}

/** GARbro `VFS.IsPathEqualsToFileName` for the single name the RPM opener special-cases. */
function isInstdata(sourcePath: string): boolean {
	const name = sourcePath.split(/[\\/]/).pop() ?? "";
	return name.toLowerCase() === INSTDATA_NAME;
}

async function parseRpmArc(
	source: ByteSource,
	sourcePath: string,
): Promise<RpmArcIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET + 4);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	// GARbro rejects archives whose narrowest possible index does not fit before the payload.
	if (BigInt(INDEX_OFFSET + count * MIN_ENTRY_LENGTH) >= source.size)
		return undefined;
	const compressionFlag = header.readUInt32LE(4);
	if (compressionFlag > 1) return undefined;
	let scheme = await guessRpmScheme(
		source,
		count,
		INDEX_OFFSET,
		POSSIBLE_NAME_SIZES,
	);
	if (!scheme) return undefined;
	// GARbro's fallback to a user-supplied scheme requires the interactive format database, so
	// only the self-describing layouts are supported here.
	if (scheme.keyword !== INSTDATA_SCHEME && isInstdata(sourcePath))
		scheme = { keyword: INSTDATA_SCHEME, nameLength: scheme.nameLength };
	const records = await readRpmIndex(source, count, INDEX_OFFSET, scheme);
	if (!records) return undefined;
	return { count, isCompressed: compressionFlag !== 0, scheme, records };
}

/** Builds one entry. Compressed entries report the declared unpacked size as their final size. */
export function createRpmEntry(
	record: RpmIndexRecord,
	id: number,
	isCompressed: boolean,
): FixedEntry {
	const { path, rawPath } = normalizeEntryPath(record.name);
	const compressed = isCompressed && record.size !== 0n;
	return createFixedEntry({
		id,
		path,
		...(rawPath === undefined ? {} : { rawPath }),
		offset: record.offset,
		// GARbro streams a zero-length stored entry as an empty payload.
		size: compressed ? record.unpackedSize : record.size,
		packedSize: record.size,
		compressed,
		metadata: { unpackedSize: record.unpackedSize.toString() },
	});
}

/** GARbro `ArcOpener.OpenEntry`: LZSS with the default frame unless the entry is stored. */
export const rpmEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed || entry.packedSize === 0n)
		return source.createReadStream(entry.offset, entry.packedSize);
	const compressed = await source.readAt(
		entry.offset,
		Number(entry.packedSize),
	);
	return Readable.from([inflateLzssAll(compressed)]);
};

export const rpmArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: rpmArcDescriptor,
	detection: { priority: -2 },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseRpmArc(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await parseRpmArc(source, sourcePath);
		if (!index)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid RPM ARC archive layout",
			);
		return {
			entries: index.records.map((record, id) =>
				createRpmEntry(record, id, index.isCompressed),
			),
			metadata: {
				entryCount: index.count,
				keyword: index.scheme.keyword,
				nameLength: index.scheme.nameLength,
				compressed: index.isCompressed,
			},
		};
	},
	openEntry: rpmEntryOpener,
});
