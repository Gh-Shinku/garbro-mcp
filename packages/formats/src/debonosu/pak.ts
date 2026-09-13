// Format reference: GARbro ArcFormats/Debonosu/ArcPAK.cs, class `PakOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { createRawInflateStream, inflateRawBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PAK\0", "latin1");
const HEADER_READ_SIZE = 0x0c;
const INDEX_HEADER_SIZE = 0x14;
/** Every index record is three sizes, flags, three timestamps and a null terminated name. */
const RECORD_SIZE = 8 + 8 + 8 + 4 + 8 + 8 + 8;
/** Flag bit that marks a directory record. */
const DIRECTORY_FLAG = 0x10;
/** Parent directories are recorded as entries whose unpacked size is their child count. */
const MAX_DEPTH = 64;

/**
 * GARbro `PakOpener.IndexReader`. The index is a raw deflate stream. Records start with a triple of
 * 64-bit sizes, flags and three timestamps; flag bit 0x10 marks a directory, whose "unpacked size" is
 * its child count, otherwise the record is an entry. Names are CP932 and null terminated.
 *
 * The reference reads without checking that the index still has bytes, and the end of the stream ends
 * the walk with an exception that rejects the archive; the port checks the same bound directly. The
 * reference also recurses without a depth limit, which the port caps to keep a hostile index from
 * exhausting the stack.
 */
interface IndexState {
	index: Buffer;
	source: ByteSource;
	baseOffset: bigint;
	entries: FixedEntry[];
	nextId: number;
}

function readName(
	index: Buffer,
	position: number,
): { name: string; next: number } | undefined {
	const terminator = index.indexOf(0, position);
	if (terminator === -1) return undefined;
	return {
		name: decodeCp932(index.subarray(position, terminator)),
		next: terminator + 1,
	};
}

function readDirectory(
	state: IndexState,
	position: number,
	count: number,
	path: string,
	depth: number,
): number | undefined {
	if (depth > MAX_DEPTH) return undefined;
	let cursor = position;
	for (let index = 0; index < count; index += 1) {
		if (cursor + RECORD_SIZE > state.index.length) return undefined;
		const offset = state.index.readBigInt64LE(cursor);
		const unpackedSize = state.index.readBigInt64LE(cursor + 8);
		const packedSize = state.index.readBigInt64LE(cursor + 16);
		const flags = state.index.readUInt32LE(cursor + 24);
		cursor += RECORD_SIZE;
		const named = readName(state.index, cursor);
		if (!named) return undefined;
		cursor = named.next;
		const name = path.length === 0 ? named.name : `${path}\\${named.name}`;
		if ((flags & DIRECTORY_FLAG) !== 0) {
			if (unpackedSize < 0n || unpackedSize > BigInt(Number.MAX_SAFE_INTEGER))
				return undefined;
			const child = readDirectory(
				state,
				cursor,
				Number(unpackedSize),
				name,
				depth + 1,
			);
			if (child === undefined) return undefined;
			cursor = child;
			continue;
		}
		if (packedSize < 0n || packedSize > BigInt(Number.MAX_SAFE_INTEGER))
			return undefined;
		const entryOffset = state.baseOffset + offset;
		// The reference trusts these ranges; the port checks them so a malformed index does not
		// produce entries that cannot be read.
		if (
			entryOffset < 0n ||
			entryOffset >= state.source.size ||
			packedSize > state.source.size ||
			entryOffset > state.source.size - packedSize
		)
			return undefined;
		// The reference casts both sizes to 32 bits, so the port keeps the same wrap.
		state.entries.push(
			createFixedEntry({
				id: state.nextId,
				...normalizeEntryPath(name),
				offset: entryOffset,
				size: BigInt.asUintN(32, unpackedSize),
				packedSize: BigInt.asUintN(32, packedSize),
				compressed: true,
			}),
		);
		state.nextId += 1;
	}
	return cursor;
}

/**
 * GARbro `PakOpener.TryOpen`. The index offset lives at 0x04, a zero word at 0x0A, and the index
 * header at that offset holds the info block size, a root record count, the unpacked index size and
 * the packed index size. The compressed index follows the info block, and payload offsets are
 * relative to the end of the packed index.
 */
async function readDebonosuIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_READ_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_READ_SIZE);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (header.readUInt16LE(10) !== 0) return undefined;
	const indexOffset = BigInt(header.readUInt16LE(4));
	if (indexOffset + BigInt(INDEX_HEADER_SIZE) > source.size) return undefined;

	const indexHeader = await source.readAt(indexOffset, INDEX_HEADER_SIZE);
	const infoSize = indexHeader.readUInt32LE(0);
	const rootCount = indexHeader.readInt32LE(8);
	const packedSize = indexHeader.readUInt32LE(0x10);
	if (!isSaneCount(rootCount) || packedSize === 0) return undefined;
	const packedOffset = indexOffset + BigInt(infoSize);
	if (packedOffset + BigInt(packedSize) > source.size) return undefined;

	const baseOffset = packedOffset + BigInt(packedSize);
	const packed = await source.readAt(packedOffset, packedSize);
	const index = await inflateRawBuffer(packed).catch(() => undefined);
	if (!index) return undefined;

	const state: IndexState = {
		index,
		source,
		baseOffset,
		entries: [],
		nextId: 0,
	};
	const end = readDirectory(state, 0, rootCount, "", 0);
	if (end === undefined || state.entries.length === 0) return undefined;
	return state.entries;
}

/** GARbro `PakOpener.OpenEntry`: every entry is a raw deflate stream. */
const debonosuPakEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.packedSize > BigInt(Number.MAX_SAFE_INTEGER))
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Debonosu PAK range");
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	return createRawInflateStream(Readable.from([payload]));
};

export const debonosuPakDescriptor: FormatDescriptor = {
	id: "debonosu-pak",
	name: "Debonosu Works resource archive",
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
			source: "ArcFormats/Debonosu/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const debonosuPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: debonosuPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDebonosuIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDebonosuIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PAK/Debonosu layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: debonosuPakEntryOpener,
});
