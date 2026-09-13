// Format reference: GARbro ArcFormats/KiriKiri/ArcXPK.cs (plus Xp3Opener.ReadUInt)
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

const SIGNATURE = Buffer.from("XPK1\x1a", "latin1");
const COUNT_OFFSET = 10;
/** `ReadUInt` requires a leading size byte of 4 before a big-endian 32-bit value. */
const VARINT_PREFIX = 4;
const VARINT_SIZE = 5;
const RECORD_TAIL = 2;

export const xpkDescriptor: FormatDescriptor = {
	id: "kirikiri-xpk",
	name: "KAG System resource archive",
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
			source: "ArcFormats/KiriKiri/ArcXPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface XpkReader {
	position: number;
}

async function readUInt(
	source: ByteSource,
	reader: XpkReader,
): Promise<number | undefined> {
	if (BigInt(reader.position + VARINT_SIZE) > source.size) return undefined;
	const bytes = await source.readAt(BigInt(reader.position), VARINT_SIZE);
	if (bytes[0] !== VARINT_PREFIX) return undefined;
	reader.position += VARINT_SIZE;
	return bytes.readUInt32BE(1);
}

/**
 * GARbro `XpkOpener.TryOpen` for archives that start with the `XPK1` signature. GARbro also finds
 * the signature inside PE executables; that embedding path needs the EXE section reader and is not
 * ported here.
 */
async function readXpkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + VARINT_SIZE)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const reader: XpkReader = { position: COUNT_OFFSET };
	const count = await readUInt(source, reader);
	if (count === undefined || !isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = await readUInt(source, reader);
		const size = await readUInt(source, reader);
		const unpackedSize = await readUInt(source, reader);
		if (
			offset === undefined ||
			size === undefined ||
			unpackedSize === undefined
		)
			return undefined;
		reader.position += RECORD_TAIL;
		if (BigInt(reader.position) > source.size) return undefined;
		const nameBytes = await readCString(source, reader);
		if (nameBytes === undefined) return undefined;
		const name = decodeCp932(nameBytes);
		const entryOffset = BigInt(offset);
		const entrySize = BigInt(size);
		// GARbro accepts a zero-length entry that starts exactly at the end of the file.
		const emptyTail = entryOffset === source.size && entrySize === 0n;
		if (!checkPlacement(entryOffset, entrySize, source.size) && !emptyTail)
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: entryOffset,
				size: entrySize,
				metadata: { unpackedSize: BigInt(unpackedSize).toString() },
			}),
		);
	}
	return entries;
}

/** GARbro `IBinaryStream.ReadCString`: CP932 bytes up to the first terminator. */
async function readCString(
	source: ByteSource,
	reader: XpkReader,
): Promise<Buffer | undefined> {
	const chunks: Buffer[] = [];
	while (BigInt(reader.position) < source.size) {
		const available = Number(
			source.size - BigInt(reader.position) < 0x100n
				? source.size - BigInt(reader.position)
				: 0x100n,
		);
		const chunk = await source.readAt(BigInt(reader.position), available);
		const terminator = chunk.indexOf(0);
		if (terminator !== -1) {
			chunks.push(chunk.subarray(0, terminator));
			reader.position += terminator + 1;
			return chunks.length === 1
				? (chunks[0] ?? Buffer.alloc(0))
				: Buffer.concat(chunks);
		}
		chunks.push(chunk);
		reader.position += available;
	}
	return chunks.length === 0 ? Buffer.alloc(0) : Buffer.concat(chunks);
}

export const xpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readXpkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readXpkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid KAG System XPK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
