// Format reference: GARBro ArcFormats/Silky/ArcAi6Win.cs, class `Ai6Opener`.
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { openAi6Entry } from "./lzss-entry.js";

const EXTENSION = "arc";
const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x104;
const WORD_SIZE = 4;
const RECORD_SIZE = NAME_SIZE + WORD_SIZE * 3;
const STORED_SIZE_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
const DATA_OFFSET_FIELD = 8;
const ASCII_SLASH = "/";
/**
 * Characters GARbro rejects through `VFS.InvalidFileNameChars`, which is the platform's
 * `Path.GetInvalidFileNameChars` minus the path separator, plus the control range that list covers.
 */
const INVALID_NAME_CHARS = new Set(['"', "<", ">", "\\", "|", ":", "*", "?"]);

export const ai6WinDescriptor: FormatDescriptor = {
	id: "silky-ai6win",
	name: "AI6WIN engine resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Silky/ArcAi6Win.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `Ai6Opener.TryOpen`. The entry count sits at 0 and each record is 0x110 bytes: a 0x104-byte
 * name field followed by three big-endian words holding the stored size, the unpacked size, and the
 * data offset.
 *
 * Names are obfuscated with a key that starts at the name length plus one and decreases by one per
 * byte, and GARbro subtracts it while decrypting. It also rejects any name holding a character that is
 * invalid in a file name, which the port mirrors, keeping the reference's exception for the path
 * separator. As in the Azurite layout, an entry is compressed when its two sizes differ and is then
 * decoded as LZSS. The data offset must land behind the index.
 */
async function readAi6WinIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const field = index.subarray(record, record + NAME_SIZE);
		const terminator = field.indexOf(0);
		if (terminator === 0) return undefined;
		const nameLength = terminator === -1 ? NAME_SIZE : terminator;
		const nameBytes = Buffer.from(field.subarray(0, nameLength));
		let key = (nameLength + 1) & 0xff;
		for (let byte = 0; byte < nameLength; byte += 1) {
			const value = ((nameBytes[byte] ?? 0) - key) & 0xff;
			key = (key - 1) & 0xff;
			const character = String.fromCharCode(value);
			if (character !== ASCII_SLASH && INVALID_NAME_CHARS.has(character))
				return undefined;
			nameBytes[byte] = value;
		}
		const name = decodeCp932(nameBytes);
		if (name.length === 0) return undefined;

		const words = record + NAME_SIZE;
		const storedSize = BigInt(index.readUInt32BE(words + STORED_SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32BE(words + UNPACKED_SIZE_FIELD),
		);
		const offset = BigInt(index.readUInt32BE(words + DATA_OFFSET_FIELD));
		if (offset < BigInt(indexSize + INDEX_OFFSET)) return undefined;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed = storedSize !== unpackedSize;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: packed ? unpackedSize : storedSize,
			packedSize: storedSize,
			compressed: packed,
		});
		// The decoder stops at the end of the stored stream rather than at the declared length.
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

export const ai6WinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai6WinDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readAi6WinIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAi6WinIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AI6WIN index layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAi6Entry,
});
