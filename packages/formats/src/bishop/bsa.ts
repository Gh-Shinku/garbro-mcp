// Format reference: GARBro ArcFormats/Bishop/ArcBSA.cs, classes `BsaOpener` and `IndexReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head reads `BSAr`, then the letter `c` as a 16-bit word, then the version and the count. */
const SIGNATURE = Buffer.from("BSAr", "ascii");
const MARKER_OFFSET = 4;
const MARKER = 0x63;
const VERSION_OFFSET = 8;
const MIN_VERSION = 1;
const MAX_VERSION = 3;
const COUNT_OFFSET = 0xa;
const INDEX_OFFSET_FIELD = 0xc;
const HEADER_SIZE = 0x10;
/** A version 1 record is a 0x20-byte name field and an offset and size pair. */
const V1_RECORD_SIZE = 0x28;
const V1_NAME_SIZE = 0x20;
const V1_OFFSET_FIELD = 0x20;
const V1_SIZE_FIELD = 0x24;
/** A version 2 record holds a name offset, an offset and a size, and the names trail the records. */
const V2_RECORD_SIZE = 0xc;
const V2_OFFSET_FIELD = 4;
const V2_SIZE_FIELD = 8;
/** A name starting with this character pushes a directory level instead of naming an entry. */
const PUSH_MARKER = ">";
/** This character pops the innermost directory level. */
const POP_MARKER = "<";

export const bsaDescriptor: FormatDescriptor = {
	id: "bishop-bsa",
	name: "Bishop resource archive",
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
			source: "ArcFormats/Bishop/ArcBSA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `IndexReader.GetPathName`: the directory stack followed by the entry name. */
function buildPath(stack: readonly string[], name: string): string {
	return stack.length === 0 ? name : `${stack.join("/")}/${name}`;
}

/**
 * Handles the directory markers both versions share. A name beginning with `>` pushes a directory level
 * holding the rest of that name, one beginning with `<` pops the innermost level when there is one, and
 * anything else names an entry, prefixed by the stack when it is not empty.
 *
 * Returns the entry name, or `undefined` when the record only changed the stack.
 */
function applyName(
	stack: string[],
	rawName: string,
): { name?: string } | undefined {
	if (rawName.length === 0) return undefined;
	if (rawName.startsWith(PUSH_MARKER)) {
		stack.push(rawName.slice(1));
		return undefined;
	}
	if (rawName.startsWith(POP_MARKER)) {
		if (stack.length > 0) stack.pop();
		return undefined;
	}
	return { name: buildPath(stack, rawName) };
}

/**
 * GARBro `IndexReader.ReadV1`. Records are 0x28 bytes: a 0x20-byte name field, then the data offset and
 * the size. Any record, including a directory marker, advances by that whole stride.
 */
function readV1Index(
	index: Buffer,
	count: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const entries: FixedEntry[] = [];
	const stack: string[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * V1_RECORD_SIZE;
		if (record + V1_RECORD_SIZE > index.length) return undefined;
		const field = index.subarray(record, record + V1_NAME_SIZE);
		const terminator = field.indexOf(0);
		const rawName = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (rawName.length === 0) return undefined;
		const resolved = applyName(stack, rawName);
		if (resolved?.name !== undefined) {
			const offset = BigInt(index.readUInt32LE(record + V1_OFFSET_FIELD));
			const size = BigInt(index.readUInt32LE(record + V1_SIZE_FIELD));
			if (!checkPlacement(offset, size, archiveSize)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(resolved.name),
					offset,
					size,
				}),
			);
		}
	}
	return entries;
}

/**
 * GARBro `IndexReader.ReadV2`. Records are twelve bytes and hold an offset into a name pool that trails
 * the whole record table, then the data offset and the size. The pool runs to the end of the file, and a
 * name offset must land inside it.
 */
function readV2Index(
	index: Buffer,
	count: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const recordsSize = count * V2_RECORD_SIZE;
	if (recordsSize > index.length) return undefined;
	const names = index.subarray(recordsSize);
	const entries: FixedEntry[] = [];
	const stack: string[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * V2_RECORD_SIZE;
		const nameOffset = index.readInt32LE(record);
		if (nameOffset < 0 || nameOffset >= names.length) return undefined;
		const terminator = names.indexOf(0, nameOffset);
		const end = terminator === -1 ? names.length : terminator;
		const rawName = decodeCp932(names.subarray(nameOffset, end));
		if (rawName.length === 0) return undefined;
		const resolved = applyName(stack, rawName);
		if (resolved?.name !== undefined) {
			const offset = BigInt(index.readUInt32LE(record + V2_OFFSET_FIELD));
			const size = BigInt(index.readUInt32LE(record + V2_SIZE_FIELD));
			if (!checkPlacement(offset, size, archiveSize)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(resolved.name),
					offset,
					size,
				}),
			);
		}
	}
	return entries;
}

/**
 * GARBro `BsaOpener.TryOpen`. The head spells `BSAr` and carries the letter `c` as a 16-bit word, the
 * version sits at 8 and must be one to three, and the entry count at 0xA. The index offset comes from
 * 0xC and must point inside the file.
 *
 * Versions above one are read with the wider record layout first, and the reference falls back to the
 * narrower reader whenever that returns nothing, which the port reproduces. Payloads are stored
 * verbatim; the reference declares no compression and no entry decoder.
 */
async function readBsaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (header.readInt16LE(MARKER_OFFSET) !== MARKER) return undefined;
	const version = header.readInt16LE(VERSION_OFFSET);
	if (version < MIN_VERSION || version > MAX_VERSION) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset >= source.size) return undefined;
	const index = await source.readAt(
		indexOffset,
		Number(source.size - indexOffset),
	);

	if (version > 1) {
		const v2 = readV2Index(index, count, source.size);
		if (v2 !== undefined) return v2;
	}
	return readV1Index(index, count, source.size);
}

export const bsaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bsaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readBsaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readBsaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Bishop BSA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
