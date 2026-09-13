// Format reference: GARBro ArcFormats/Liar/ArcXFL.cs, class `XflOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The signature is the four bytes `LB` and a version word. */
const SIGNATURE = Buffer.from([0x4c, 0x42, 0x01, 0x00]);
const DIR_SIZE_OFFSET = 4;
const COUNT_OFFSET = 8;
const HEADER_SIZE = 12;
/** A record is a 32-byte name field followed by the data offset and size. */
const RECORD_SIZE = 40;
const NAME_SIZE = 32;
const OFFSET_FIELD = 32;
const SIZE_FIELD = 36;
/** A record whose name ends this way and whose data begins with the signature is a nested directory. */
const NESTED_EXTENSION = "xfl";
/** Bounds the recursion, which the reference leaves unbounded. */
const MAXIMUM_DEPTH = 32;

export const xflDescriptor: FormatDescriptor = {
	id: "liar-xfl",
	name: "Liar engine resource archive",
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
			source: "ArcFormats/Liar/ArcXFL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `XflOpener.ReadDirectory`, used recursively. A directory begins with its own signature, the size of the
 * directory region and an entry count. Its records start twelve bytes in and are forty bytes wide — a 32-byte
 * name field, the data offset relative to the region's end, and the size — and the region ends where the payloads
 * begin.
 *
 * A record is not always a file: when its name ends in `.xfl` and the payload begins with the signature, the
 * reference recurses into it as a nested directory, and only falls back to treating it as an entry when that
 * recursion yields nothing. Nested entries keep the path their directory was found under.
 *
 * Every payload is checked against the *enclosing* region's end rather than the file's, since a nested directory
 * may not reach past itself. The reference bounds neither the recursion nor a nested directory's own entry
 * count against the spec, so the port caps the depth; payloads are stored verbatim, and the reference's archive
 * writing support is out of scope here.
 */
async function readDirectory(
	source: ByteSource,
	baseOffset: bigint,
	maxOffset: bigint,
	baseDir: string,
	depth: number,
): Promise<FixedEntry[] | undefined> {
	if (depth > MAXIMUM_DEPTH) return undefined;
	if (baseOffset + BigInt(HEADER_SIZE) > maxOffset) return undefined;
	const header = await source.readAt(baseOffset, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const directorySize = BigInt(header.readUInt32LE(DIR_SIZE_OFFSET));
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = baseOffset + directorySize + BigInt(HEADER_SIZE);
	if (directorySize >= maxOffset || dataOffset >= maxOffset) return undefined;
	const recordsSize = count * RECORD_SIZE;
	if (baseOffset + BigInt(HEADER_SIZE + recordsSize) > dataOffset)
		return undefined;
	const records = await source.readAt(
		baseOffset + BigInt(HEADER_SIZE),
		recordsSize,
	);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const rawName = decodeCStringField(records, record, NAME_SIZE);
		if (rawName.length === 0) return undefined;
		const entryOffset =
			dataOffset + BigInt(records.readUInt32LE(record + OFFSET_FIELD));
		const entrySize = BigInt(records.readUInt32LE(record + SIZE_FIELD));
		const name = baseDir.length === 0 ? rawName : `${baseDir}/${rawName}`;

		let nested: FixedEntry[] | undefined;
		if (
			rawName.toLowerCase().endsWith(`.${NESTED_EXTENSION}`) &&
			entryOffset + BigInt(SIGNATURE.length) <= maxOffset
		) {
			const probe = await source.readAt(entryOffset, SIGNATURE.length);
			if (probe.equals(SIGNATURE)) {
				nested = await readDirectory(
					source,
					entryOffset,
					entryOffset + entrySize,
					name,
					depth + 1,
				);
			}
		}
		if (nested !== undefined && nested.length > 0) {
			entries.push(...nested);
			continue;
		}
		if (!checkPlacement(entryOffset, entrySize, maxOffset)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset: entryOffset,
				size: entrySize,
			}),
		);
	}
	return entries;
}

/**
 * GARBro `XflOpener.TryOpen`. The whole file is one directory at offset zero, whose end is the file's own length,
 * and the format carries no extension of its own, so the signature and the directory walk are the detection.
 */
async function readXflIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	return readDirectory(source, 0n, source.size, "", 0);
}

export const xflFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xflDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readXflIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readXflIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Liar XFL layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
