// Format reference: GARBro ArcFormats/Tanaka/ArcARCG.cs, class `ArcGOpener`.
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSIONS = ["arc", "bmx", "scb", "vpk"];
const SIGNATURE = Buffer.from("ARCG", "ascii");
/** The word at 4 is a fixed marker the reference compares exactly. */
const MARKER_OFFSET = 4;
const MARKER = 0x10000;
const INDEX_OFFSET_FIELD = 8;
const INDEX_SIZE_FIELD = 0x0c;
const DIRECTORY_COUNT_FIELD = 0x10;
const COUNT_FIELD = 0x12;
const HEADER_SIZE = 0x16;
/** A directory record is a name length, the name, an absolute index offset and a file count. */
const DIRECTORY_COUNT_TAIL = 4;
const DIRECTORY_TAIL_SIZE = 8;
/** A file record is a name length, the name, and the payload's offset and size. */
const FILE_TAIL_SIZE = 8;
/** Names written with a half-width question mark are stored with its full-width form instead. */
const NAME_REPLACEMENT = /[?]/g;
const FULL_WIDTH_QUESTION = "\uff1f";

export const arcgDescriptor: FormatDescriptor = {
	id: "tanaka-arcg",
	name: "Tanaka Tatsuhiro's engine resource archive",
	extensions: EXTENSIONS,
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
			source: "ArcFormats/Tanaka/ArcARCG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `ArcGOpener.TryOpen` for archives whose index is inside the file. The signature spells `ARCG`, the word
 * at 4 is a fixed marker, and the index offset, index size, directory count and entry count follow it. An index
 * offset of zero means the real index lives in a companion `.bmi` file instead, which the reference decrypts with
 * a keystream seeded from a passphrase that is either configured per volume serial or read from the Windows
 * volume itself — a key this port cannot obtain, and one GARbro cannot either on a different volume, so only the
 * embedded layout is handled here.
 *
 * The index is hierarchical. Its directory records hold a name, an *absolute* index offset for that directory's
 * file records and their count, while each file record holds a name and the payload's offset and size. Names are
 * stored with a length that counts their own terminator, `?` characters are replaced with the full-width form,
 * and each entry's name is joined to its directory's. Payloads are stored verbatim, and the reference's
 * content-signature type pass is left out.
 */
async function readArcgIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (!EXTENSIONS.includes(sourceExtension(sourcePath))) return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (header.readUInt32LE(MARKER_OFFSET) !== MARKER) return undefined;
	const indexOffset = header.readInt32LE(INDEX_OFFSET_FIELD);
	if (indexOffset === 0) return undefined;
	const indexSize = header.readInt32LE(INDEX_SIZE_FIELD);
	const directoryCount = header.readUInt16LE(DIRECTORY_COUNT_FIELD);
	const count = header.readInt32LE(COUNT_FIELD);
	if (indexOffset < 0 || BigInt(indexOffset) >= source.size) return undefined;
	if (indexSize <= 0 || BigInt(indexOffset + indexSize) > source.size)
		return undefined;
	if (!isSaneCount(count)) return undefined;
	const index = await source.readAt(BigInt(indexOffset), indexSize);

	const entries: FixedEntry[] = [];
	let position = 0;
	for (let directory = 0; directory < directoryCount; directory += 1) {
		if (position + 1 > index.length) return undefined;
		const nameLength = index.readUInt8(position);
		if (nameLength <= 1) return undefined;
		const directoryName = decodeCStringField(
			index,
			position + 1,
			nameLength - 1,
		);
		position += nameLength;
		if (position + DIRECTORY_TAIL_SIZE > index.length) return undefined;
		// The directory's own records are addressed absolutely, so the index's own start comes off first.
		let filePosition = index.readInt32LE(position) - indexOffset;
		const fileCount = index.readInt32LE(position + DIRECTORY_COUNT_TAIL);
		position += DIRECTORY_TAIL_SIZE;
		if (filePosition < 0 || filePosition >= index.length) return undefined;
		if (fileCount < 0 || fileCount > count) return undefined;

		for (let file = 0; file < fileCount; file += 1) {
			if (filePosition + 1 > index.length) return undefined;
			const fileLength = index.readUInt8(filePosition);
			if (fileLength === 0) return undefined;
			const rawName = decodeCStringField(
				index,
				filePosition + 1,
				fileLength - 1,
			);
			if (rawName.length === 0) return undefined;
			const fileName = rawName.replace(NAME_REPLACEMENT, FULL_WIDTH_QUESTION);
			filePosition += fileLength;
			if (filePosition + FILE_TAIL_SIZE > index.length) return undefined;
			const offset = BigInt(index.readUInt32LE(filePosition));
			const size = BigInt(index.readUInt32LE(filePosition + 4));
			if (!checkPlacement(offset, size, source.size)) return undefined;
			const path =
				directoryName.length === 0 ? fileName : `${directoryName}/${fileName}`;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(path),
					offset,
					size,
				}),
			);
			filePosition += FILE_TAIL_SIZE;
		}
	}
	return entries;
}

export const arcgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: arcgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readArcgIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readArcgIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tanaka ARCG layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
