// Format reference: GARBro ArcFormats/NekoSDK/ArcPAK.cs, class `PakOpener` (NEKOPACK/4).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const MARKER = Buffer.from("NEKOPACK4", "ascii");
const VERSION_OFFSET = 9;
/** Layout of the two known index versions: where the index starts and what its length word means. */
interface IndexVersion {
	indexOffset: number;
	/** Added to the length word to find the end of the index. */
	indexEndBase: number;
}
const VERSIONS = new Map<string, IndexVersion>([
	["A", { indexOffset: 0x0e, indexEndBase: 0x0e }],
	["S", { indexOffset: 0x0a, indexEndBase: 0x16 }],
]);
const LENGTH_OFFSET = 0x0a;
/** The version byte and the length word have to be readable before the layout is known. */
const HEADER_READ_SIZE = 0x10;
/** Names are limited to a 0x100-byte buffer. */
const NAME_BUFFER_SIZE = 0x100;
/** The opener decrypts at most four bytes in place and hashes the stored size into the key. */
const HEADER_SIZE = 4;
const KEY_BASE = 0x22;
const KEY_STEP = 8;
/** A stored entry of this size or more keeps its unpacked size in its last word. */
const TRAILER_MIN_SIZE = 8n;

function readIndexVersion(version: number): IndexVersion | undefined {
	return VERSIONS.get(String.fromCharCode(version));
}

/**
 * GARBro `PakOpener.TryOpen`. The index is a run of records — a 32-bit name length, the name, then the
 * payload offset and size, both exclusive-ored with a key derived from the name's bytes read as
 * *signed* values. A zero name length ends the index.
 *
 * The two known versions differ in where the index starts and how its length word is used; in the `S`
 * layout that word is also the first name length, which the reference reads again from the index.
 * Entries of eight bytes or more keep their unpacked size in their last word, which the port reads
 * while listing so the declared size and the extraction agree.
 *
 * The reference also clears the type of `.alp` names; entry typing comes from the extension catalog,
 * which the port does not reproduce, so no type is recorded either way.
 */
async function readPakIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_READ_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_READ_SIZE);
	if (!header.subarray(0, MARKER.length).equals(MARKER)) return undefined;
	const version = readIndexVersion(header[VERSION_OFFSET] ?? 0);
	if (!version) return undefined;
	const lengthWord = BigInt(header.readUInt32LE(LENGTH_OFFSET));
	const indexStart = BigInt(version.indexOffset);
	const indexEnd = lengthWord + BigInt(version.indexEndBase);
	if (indexEnd > source.size) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = indexStart;
	while (indexOffset < indexEnd) {
		if (indexOffset + 4n > source.size) return undefined;
		const lengthBuffer = await source.readAt(indexOffset, 4);
		const nameLength = lengthBuffer.readUInt32LE(0);
		indexOffset += 4n;
		if (nameLength === 0) break;
		if (nameLength > NAME_BUFFER_SIZE) return undefined;
		if (indexOffset + BigInt(nameLength) + 8n > source.size) return undefined;
		const record = await source.readAt(indexOffset, nameLength + 8);
		const nameBytes = record.subarray(0, nameLength);
		const name = decodeCStringField(nameBytes, 0, nameLength);
		indexOffset += BigInt(nameLength);
		let key = 0;
		for (const byte of nameBytes) key += byte < 0x80 ? byte : byte - 0x100;
		const offset = BigInt(
			(record.readUInt32LE(nameLength) ^ (key >>> 0)) >>> 0,
		);
		const storedSize = BigInt(
			(record.readUInt32LE(nameLength + 4) ^ (key >>> 0)) >>> 0,
		);
		indexOffset += 8n;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size: storedSize,
			packedSize: storedSize,
			compressed: true,
		});
		if (storedSize >= TRAILER_MIN_SIZE) {
			const trailer = await source.readAt(offset + storedSize - 4n, 4);
			entry.size = BigInt(trailer.readUInt32LE(0));
		} else {
			entry.sizeKnown = false;
		}
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARBro's key schedule for the four byte header: the stored size sets a starting key. */
function headerKey(storedSize: bigint): number {
	return Math.floor(Number(storedSize) / KEY_STEP) + KEY_BASE;
}

/**
 * GARBro `PakOpener.OpenEntry`. The first four stored bytes are decrypted in place, each with its own
 * shifted key byte, and are followed by the middle of the payload — the last word holds the unpacked
 * size and is not part of the stream. The result is a zlib stream.
 *
 * An entry of four bytes or fewer is nothing but its decrypted header. The reference would compute a
 * wrapped length for entries between five and seven bytes; the port rejects those.
 */
const pakEntryOpener: FixedEntryOpener = async (source, entry) => {
	const storedSize = Number(entry.packedSize);
	const headerLength = Math.min(HEADER_SIZE, storedSize);
	let key = headerKey(entry.packedSize);
	const header = Buffer.from(await source.readAt(entry.offset, headerLength));
	for (let index = 0; index < header.length; index += 1) {
		header[index] = (header[index] ?? 0) ^ (key & 0xff);
		key = (key << 3) >>> 0;
	}
	if (headerLength === storedSize)
		return createZlibInflateStream(Readable.from([header]));
	if (storedSize < HEADER_SIZE + 4)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid NEKOPACK entry size");
	const middle = await source.readAt(
		entry.offset + BigInt(HEADER_SIZE),
		storedSize - HEADER_SIZE - 4,
	);
	return createZlibInflateStream(Readable.from([header, middle]));
};

export const nekoSdkPakDescriptor: FormatDescriptor = {
	id: "nekosdk-pak",
	name: "NekoSDK engine resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/NekoSDK/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const nekoSdkPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: nekoSdkPakDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("NEKO", "ascii") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPakIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPakIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NEKOPACK4 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pakEntryOpener,
});
