// Format reference: GARBro ArcFormats/Ism/ArcISA.cs, classes `IsaOpener` and `IsaIndexReader`.
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

const SIGNATURE = Buffer.from("ISM ", "ascii");
const MARKER_OFFSET = 4;
const MARKER = Buffer.from("ARCHIVED", "ascii");
const COUNT_OFFSET = 0x0c;
const VERSION_OFFSET = 0x0e;
/** The high bit of the version word marks encryption, which the reference never applies here. */
const ENCRYPTED_VERSION_BIT = 0x8000;
const INDEX_OFFSET = 0x10;
const OFFSET_FIELD = 4;
const SIZE_FIELD = 8;
/** Two record layouts, tried in this order; the first is skipped for version one. */
const LAYOUTS = [
	{ nameLength: 0x0c, recordLength: 0x14 },
	{ nameLength: 0x30, recordLength: 0x10 },
] as const;
/** Names shorter than this may have had their extension truncated, so the reference repairs a few. */
const TRUNCATED_NAME_LIMIT = 0x20;
const TRUNCATED_AUDIO_SUFFIX = ".OG";
const TRUNCATED_IMAGE_SUFFIX = ".PN";
const RECORD_TAIL = OFFSET_FIELD + SIZE_FIELD;
const MIN_RECORD_LENGTH = OFFSET_FIELD + SIZE_FIELD;

export const isaDescriptor: FormatDescriptor = {
	id: "ism-isa",
	name: "ISM engine resource archive",
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
			source: "ArcFormats/Ism/ArcISA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `IsaIndexReader.ReadIndex`. Records start at 0x10 whatever the layout: a fixed-width name field
 * followed by four bytes the reference skips, the data offset and the size. The name field width and the
 * stride differ between the two layouts, and the second layout's stride is narrower than its name field,
 * which the port mirrors rather than correcting.
 *
 * A name shorter than thirty-two bytes may have lost its extension in the field, so the reference repairs
 * `.OG` into audio and `.PN` into image; the port records the same conclusion as metadata. The reference
 * reads the version's encryption bit and never applies it, so no decryption is performed here.
 */
function readLayout(
	index: Buffer,
	count: number,
	nameLength: number,
	recordLength: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	if (recordLength < MIN_RECORD_LENGTH) return undefined;
	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + nameLength + RECORD_TAIL > index.length) return undefined;
		const field = index.subarray(position, position + nameLength);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		const words = position + nameLength;
		const offset = BigInt(index.readUInt32LE(words + OFFSET_FIELD));
		const size = BigInt(index.readUInt32LE(words + SIZE_FIELD));
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		let inferredType: string | undefined;
		if (nameLength < TRUNCATED_NAME_LIMIT) {
			if (name.endsWith(TRUNCATED_AUDIO_SUFFIX)) inferredType = "audio";
			else if (name.endsWith(TRUNCATED_IMAGE_SUFFIX)) inferredType = "image";
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				...(inferredType === undefined ? {} : { metadata: { inferredType } }),
			}),
		);
		position += nameLength + recordLength;
		if (position > index.length) return undefined;
	}
	return entries;
}

/**
 * GARBro `IsaOpener.TryOpen`. The head spells `ISM ARCHIVED`, the entry count sits at 0x0C and the
 * version word at 0x0E, whose high bit the reference reads as an encryption flag and then ignores. A
 * version other than one is tried with the first layout and falls back to the second, while version one
 * skips straight to the second; the port keeps that ordering.
 */
async function readIsaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		!header
			.subarray(MARKER_OFFSET, MARKER_OFFSET + MARKER.length)
			.equals(MARKER)
	)
		return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const version = header.readUInt16LE(VERSION_OFFSET) & ~ENCRYPTED_VERSION_BIT;
	const index = await source.readAt(
		BigInt(INDEX_OFFSET),
		Number(source.size - BigInt(INDEX_OFFSET)),
	);
	const start = version !== 1 ? 0 : 1;
	for (let candidate = start; candidate < LAYOUTS.length; candidate += 1) {
		const layout = LAYOUTS[candidate];
		if (!layout) continue;
		const entries = readLayout(
			index,
			count,
			layout.nameLength,
			layout.recordLength,
			source.size,
		);
		if (entries) return entries;
	}
	return undefined;
}

export const isaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: isaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readIsaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIsaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ISM ISA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
