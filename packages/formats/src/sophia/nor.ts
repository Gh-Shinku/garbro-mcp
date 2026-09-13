// Format reference: GARBro Legacy/Sophia/ArcNOR.cs, class `NorOpener` and its `NcmbDecompress`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	readCStringAt,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const MARKER_OFFSET = 4;
const MARKER = Buffer.from("NRCOMB01\0", "ascii");
const INDEX_START = 0x10;

/** Payload header of a compressed entry. */
const PAYLOAD_MARKER = Buffer.from("NCMB01", "ascii");
const PAYLOAD_HEADER_SIZE = 0x2c;
/** Stored size inside the payload header; the unpacked size sits at 0x24. */
const PAYLOAD_PACKED_SIZE = 0x10;
const PAYLOAD_UNPACKED_SIZE = 0x24;
/** Method word inside the payload header; these two mean the payload is stored behind the header. */
const PAYLOAD_METHOD = 0x28;
const STORED_METHODS = new Set([0x1f4, 0x67]);

/** The node table holds six words per node but only the left and right children are used. */
const NODE_STRIDE = 6;
const NODE_COUNT = 0xc00 / NODE_STRIDE;
const LEAF = -1;

interface PayloadHeader {
	method: number;
	packedSize: bigint;
	unpackedSize: bigint;
}

/**
 * GARbro `NorOpener.TryOpen`: a count, a fixed marker and records of offset, size and a null-terminated
 * name from 0x10. The reference has no registered signature, so the marker is the whole detection.
 */
async function readNorIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (
		!header
			.subarray(MARKER_OFFSET, MARKER_OFFSET + MARKER.length)
			.equals(MARKER)
	)
		return undefined;
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_START);
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + 8n > source.size) return undefined;
		const record = await source.readAt(indexOffset, 8);
		const offset = BigInt(record.readUInt32LE(0));
		const size = BigInt(record.readUInt32LE(4));
		const name = await readCStringAt(source, indexOffset + 8n);
		indexOffset = name.end;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name.value),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARbro `NorOpener.OpenEntry` decides what a payload is while opening it, so the port resolves the same
 * thing while listing. A payload that does not start with the marker is stored as is. One that does is
 * read further: a stored method keeps the payload stored behind a 0x2C-byte header and takes its size
 * from the header, while any other method means the payload is compressed with the entry's own tree
 * codec and its sizes come from the header as well.
 */
async function readPayloadHeader(
	source: ByteSource,
	offset: bigint,
): Promise<PayloadHeader | undefined> {
	if (offset + BigInt(PAYLOAD_HEADER_SIZE) > source.size) return undefined;
	const header = await source.readAt(offset, PAYLOAD_HEADER_SIZE);
	if (!header.subarray(0, PAYLOAD_MARKER.length).equals(PAYLOAD_MARKER))
		return undefined;
	return {
		method: header.readInt32LE(PAYLOAD_METHOD),
		packedSize: BigInt(header.readUInt32LE(PAYLOAD_PACKED_SIZE)),
		unpackedSize: BigInt(header.readUInt32LE(PAYLOAD_UNPACKED_SIZE)),
	};
}

/**
 * Resolves an entry that carries a payload header. A stored method leaves the payload behind the
 * header; any other method marks the entry as compressed to its declared unpacked size.
 */
async function resolveNorEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<FixedEntry | undefined> {
	if (entry.offset + BigInt(PAYLOAD_MARKER.length) > source.size) return entry;
	const signature = await source.readAt(entry.offset, PAYLOAD_MARKER.length);
	if (!signature.equals(PAYLOAD_MARKER)) return entry;
	const header = await readPayloadHeader(source, entry.offset);
	if (!header) return undefined;
	const payloadOffset = entry.offset + BigInt(PAYLOAD_HEADER_SIZE);
	if (STORED_METHODS.has(header.method)) {
		if (!checkPlacement(payloadOffset, header.packedSize, source.size))
			return undefined;
		entry.offset = payloadOffset;
		entry.size = header.packedSize;
		entry.packedSize = header.packedSize;
		return entry;
	}
	if (
		!checkPlacement(payloadOffset, header.packedSize, source.size) ||
		header.unpackedSize > BigInt(Number.MAX_SAFE_INTEGER)
	)
		return undefined;
	entry.offset = payloadOffset;
	entry.size = header.unpackedSize;
	entry.packedSize = header.packedSize;
	entry.compressed = true;
	return entry;
}

/**
 * GARbro `NcmbDecompress`. The stream opens with the root node, the tree size and the unpacked size,
 * followed by one record per node: an index, then its left and right children. Bits are read from the
 * most significant bit of each byte and walk the tree until a node whose left child is -1 is reached;
 * that node's index is the output byte.
 *
 * The reference relies on zero-initialized tables and would loop on a malformed tree. The port rejects
 * a node index outside the table instead.
 */
export function decompressNcmb(input: Buffer): Buffer {
	let position = 0;
	const readInt32 = (): number => {
		if (position + 4 > input.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated NCMB header");
		const value = input.readInt32LE(position);
		position += 4;
		return value;
	};

	const root = readInt32();
	const treeSize = readInt32();
	const unpackedSize = readInt32();
	const dict = new Int32Array(NODE_COUNT * NODE_STRIDE);
	let count = root + treeSize - 0xff;
	while (count > 0) {
		count -= 1;
		const node = readInt32() * NODE_STRIDE;
		if (node < 0 || node + 1 >= dict.length)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NCMB node");
		dict[node] = readInt32();
		dict[node + 1] = readInt32();
	}
	const output = Buffer.alloc(unpackedSize > 0 ? unpackedSize : 0);
	let currentByte = 0;
	let mask = 0;
	for (let destination = 0; destination < unpackedSize; destination += 1) {
		let token = root;
		for (;;) {
			if (mask === 0) {
				if (position >= input.length)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated NCMB stream");
				currentByte = input[position] ?? 0;
				position += 1;
				mask = 0x80;
			}
			const node = token * NODE_STRIDE;
			if (node < 0 || node + 1 >= dict.length)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid NCMB node");
			token =
				(currentByte & mask) !== 0 ? (dict[node + 1] ?? 0) : (dict[node] ?? 0);
			mask >>= 1;
			const next = token * NODE_STRIDE;
			if (next < 0 || next + 1 >= dict.length)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid NCMB node");
			if (dict[next] === LEAF) break;
		}
		output[destination] = token & 0xff;
	}
	return output;
}

/** GARbro `NorOpener.OpenEntry`: stored payloads pass through, compressed ones use the tree codec. */
const norEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([decompressNcmb(stored)]);
};

export const sophiaNorDescriptor: FormatDescriptor = {
	id: "sophia-nor",
	name: "Sophia resource archive",
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
			source: "Legacy/Sophia/ArcNOR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sophiaNorFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sophiaNorDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		const entries = await readNorIndex(source);
		if (!entries) return false;
		for (const entry of entries) {
			if (!(await resolveNorEntry(source, entry))) return false;
		}
		return true;
	},
	async read(source: ByteSource) {
		const entries = await readNorIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NOR layout");
		for (const entry of entries) {
			if (!(await resolveNorEntry(source, entry)))
				throw new GarbroError("INVALID_ARCHIVE", "Invalid NOR payload");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: norEntryOpener,
});
