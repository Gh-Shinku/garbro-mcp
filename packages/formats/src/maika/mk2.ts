// Format reference: GARbro ArcFormats/Maika/ArcMK2.cs, class `Mk2Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import {
	type Mk2Entry,
	openMk2Entry,
	probeCompression,
	schemeForArchiveId,
	schemeIdOf,
} from "./mk2-pack.js";

/** The reference checks the first five bytes against these ids and a `0\0` pair at 0x04. */
const SIGNATURES = ["MK2.0", "BL2.0", "SL1.0", "LS2.0", "AR2.0", "MP2.0"].map(
	(id) => Buffer.from(`${id}\0`, "latin1"),
);

/** The reference reads the entry count at 0x12, so the header spans at least 0x16 bytes. */
const HEADER_SIZE = 0x16;
const BASE_OFFSET_FIELD = 8;
const INDEX_SIZE_FIELD = 0x0a;
const INDEX_OFFSET_FIELD = 0x0e;
const COUNT_FIELD = 0x12;
/** Each group header is a relative pointer and a record count. */
const GROUP_HEADER_SIZE = 6;
/** The reference stops after this many group headers. */
const MAX_GROUPS = 512;
/** A group with no records ends the walk when its pointer holds this value. */
const TERMINATOR = -1;

/**
 * GARbro `Mk2Opener.TryOpen`. The header holds a base offset at 0x08, the index size at 0x0A, the index
 * offset at 0x0E and an entry count at 0x12 that is only sanity checked.
 *
 * The index is a run of group headers: a 32-bit offset relative to the index start and a 16-bit record
 * count. Records follow each header and are walked sequentially — a payload offset relative to the
 * header's base offset, a stored size, a one byte name length and a CP932 name. A group without records
 * ends the walk when its pointer word reads minus one, and the walk is capped at 512 groups. Payloads
 * have to sit before the index, and a zero name length rejects the archive.
 *
 * The scramble scheme comes from the archive id, its first five bytes.
 */
async function readMk2Index(
	source: ByteSource,
): Promise<Mk2Entry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const signature = SIGNATURES.find((candidate) =>
		header.subarray(0, candidate.length).equals(candidate),
	);
	if (!signature) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = BigInt(header.readUInt16LE(BASE_OFFSET_FIELD));
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_FIELD));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + indexSize > source.size) return undefined;
	const scheme = schemeForArchiveId(
		signature.subarray(0, 5).toString("latin1"),
	);

	const entries: Mk2Entry[] = [];
	let groupOffset = indexOffset;
	for (let group = 0; group < MAX_GROUPS; group += 1) {
		if (groupOffset + BigInt(GROUP_HEADER_SIZE) > source.size) return undefined;
		const groupHeader = await source.readAt(groupOffset, GROUP_HEADER_SIZE);
		const relative = BigInt(groupHeader.readUInt32LE(0));
		const records = groupHeader.readUInt16LE(4);
		let recordOffset = (relative + indexOffset) & 0xffffffffn;
		if (records > 0) {
			for (let index = 0; index < records; index += 1) {
				if (recordOffset + 9n > source.size) return undefined;
				const record = await source.readAt(recordOffset, 9);
				// The reference adds the base offset as a 32-bit value and wraps.
				const entryOffset =
					(BigInt(record.readUInt32LE(0)) + baseOffset) & 0xffffffffn;
				const storedSize = BigInt(record.readUInt32LE(4));
				const nameLength = record[8] ?? 0;
				if (nameLength === 0) return undefined;
				// GARbro reads names with a clamped read, so a name that reaches past the end of the
				// file is shortened instead of rejecting the archive.
				const nameStart = recordOffset + 9n;
				const available = Number(
					source.size - nameStart < BigInt(nameLength)
						? source.size - nameStart
						: BigInt(nameLength),
				);
				const nameField =
					available > 0
						? await source.readAt(nameStart, available)
						: Buffer.alloc(0);
				const name = decodeCStringField(nameField, 0, nameLength);
				recordOffset += 9n + BigInt(nameLength);
				// Payloads have to sit before the index, not before the end of the file.
				if (!checkPlacement(entryOffset, storedSize, indexOffset))
					return undefined;
				const probe = await probeCompression(
					source,
					entryOffset,
					storedSize,
					scheme,
				);
				const compressed = probe !== undefined;
				const entry = createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(name),
					offset: entryOffset,
					size: storedSize,
					compressed,
					...(probe
						? {
								metadata: {
									compressionSignature: probe.signature,
									innerPackedSize: probe.innerPackedSize,
									scrambleScheme: schemeIdOf(scheme),
								},
							}
						: {}),
				}) as Mk2Entry;
				if (compressed) entry.sizeKnown = false;
				entries.push(entry);
			}
		} else {
			const pointer = await source
				.readAt(recordOffset, 4)
				.catch(() => undefined);
			if (!pointer) return undefined;
			if (pointer.readInt32LE(0) === TERMINATOR) break;
		}
		groupOffset += BigInt(GROUP_HEADER_SIZE);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const maikaMk2Descriptor: FormatDescriptor = {
	id: "maika-mk2",
	name: "MAIKA resource archive",
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
			source: "ArcFormats/Maika/ArcMK2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const maikaMk2Format: ArchiveFormat = defineFixedArchive({
	descriptor: maikaMk2Descriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source) {
		return (await readMk2Index(source)) !== undefined;
	},
	async read(source) {
		const entries = await readMk2Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MAIKA MK2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openMk2Entry,
});
