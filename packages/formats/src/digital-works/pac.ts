// Format reference: GARbro ArcFormats/DigitalWorks/ArcPAC.cs, class `PacOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PPAC-PAC", "ascii");
const INDEX_SIGNATURE = Buffer.from("PPAC-HED", "ascii");
const INDEX_OFFSET = 0x10;
/** A record is a 0x10-byte name, an offset and a size. */
const NAME_SIZE = 0x10;
const OFFSET_FIELD = 0x10;
const SIZE_FIELD = 0x14;
const RECORD_SIZE = 0x20;
/** Payload offsets are biased by the ten-byte header the reference skips. */
const DATA_BIAS = 0x10;
const LZS_MARKER = Buffer.from("LZS\0", "ascii");
const PACKED_HEADER_SIZE = 8;
/** GARbro masks the low nibble of the first byte when it looks for a nested LZS stream. */
const EMBEDDED_MASK = 0xffffff0f;
const EMBEDDED_SIGNATURE = 0x535a4c0f;
/** Nested streams carry their own eight-byte header inside the decoded data. */
const EMBEDDED_HEADER_SIZE = 8;

export const digitalWorksPacDescriptor: FormatDescriptor = {
	id: "digital-works-pac",
	name: "Digital Works resource archive",
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
			source: "ArcFormats/DigitalWorks/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PacOpener.TryOpen`. The archive itself only carries the `PPAC-PAC` signature; the index
 * lives in a sibling `.hed` file that must start with `PPAC-HED`, and the reference counts records as
 * `(hedLength - 0x10) / 0x20`. Each record holds a 0x10-byte CP932 name, an offset biased by 0x10 and
 * a stored size, and payloads are checked against the archive.
 *
 * `OpenEntry` sets the packed flag lazily when an entry starts with `LZS\0`, taking the unpacked size
 * from the next word and decoding everything behind the eight-byte header. The port performs the same
 * inspection while reading the index so listing and extraction agree, and records in entry metadata
 * whether the decoded data starts with a nested LZS stream.
 */
async function readDigitalWorksIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(SIGNATURE.length)) return undefined;
	if (!(await source.readAt(0n, SIGNATURE.length)).equals(SIGNATURE))
		return undefined;
	const indexName = basename(changeExtension(sourcePath, "hed"));
	const index = await readCompanionFile(sourcePath, indexName);
	if (!index || index.length < INDEX_OFFSET + RECORD_SIZE) return undefined;
	if (!index.subarray(0, INDEX_SIGNATURE.length).equals(INDEX_SIGNATURE))
		return undefined;
	const count = Math.trunc((index.length - INDEX_OFFSET) / RECORD_SIZE);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	for (
		let indexOffset = INDEX_OFFSET;
		indexOffset + RECORD_SIZE <= index.length;
		indexOffset += RECORD_SIZE
	) {
		const name = decodeCStringField(index, indexOffset, NAME_SIZE);
		const offset =
			BigInt(index.readUInt32LE(indexOffset + OFFSET_FIELD)) +
			BigInt(DATA_BIAS);
		const storedSize = BigInt(index.readUInt32LE(indexOffset + SIZE_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		let size = storedSize;
		let packedSize = storedSize;
		let compressed = false;
		let embedded = false;
		if (storedSize >= BigInt(PACKED_HEADER_SIZE)) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, LZS_MARKER.length).equals(LZS_MARKER)) {
				compressed = true;
				size = BigInt(probe.readUInt32LE(LZS_MARKER.length));
				packedSize = storedSize - BigInt(PACKED_HEADER_SIZE);
				if (packedSize >= 4n) {
					const signature = (
						await source.readAt(offset + BigInt(PACKED_HEADER_SIZE), 4)
					).readUInt32LE(0);
					embedded = (signature & EMBEDDED_MASK) === EMBEDDED_SIGNATURE;
				}
			}
		}
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset: offset + (compressed ? BigInt(PACKED_HEADER_SIZE) : 0n),
			size,
			packedSize,
			compressed,
			...(compressed ? { metadata: { embedded } } : {}),
		});
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

/**
 * GARbro `PacOpener.OpenEntry`. Plain entries have their payload decoded as one LZSS stream. Entries
 * whose decoded payload starts with a nested LZS marker are decoded twice: the first stream yields an
 * eight-byte header and the second stream, and the header's second word is the nested unpacked size.
 */
const digitalWorksEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Digital Works entry"),
	);
	const decoded = inflateLzssAll(stored);
	if (
		entry.metadata?.embedded !== true ||
		decoded.length < EMBEDDED_HEADER_SIZE
	)
		return Readable.from([decoded]);
	return Readable.from([
		inflateLzssAll(decoded.subarray(EMBEDDED_HEADER_SIZE)),
	]);
};

export const digitalWorksPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: digitalWorksPacDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDigitalWorksIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDigitalWorksIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Digital Works PAC layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: digitalWorksEntryOpener,
});
