// Format reference: GARBro ArcFormats/Lilim/ArcFGA.cs (class `FgaOpener`) and
// ArcFormats/Lilim/ArcAOS.cs (classes `AosOpener`, `PackedEntry`).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decompressHuffman } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "fga";
/** Every index block is exactly this long. */
const INDEX_BLOCK_SIZE = 0x318;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x0c;
const OFFSET_FIELD = 0x0c;
const SIZE_FIELD = 0x10;
/** A record whose first byte is this value continues the index at the offset in its offset field. */
const CHAIN_MARKER = 0xff;
/** A zero first byte ends the block. */
const BLOCK_END = 0x00;
/** Records whose name carries this extension are Huffman-compressed. */
const PACKED_EXTENSION = "scr";
/** Payloads start with the unpacked size, then the compressed stream. */
const PACKED_HEADER_SIZE = 4;
/** Bounds a chained index from looping or from allocating without limit. */
const MAX_BLOCKS = 0x10000;
const MAX_ENTRIES = 0x100000;

export const fgaDescriptor: FormatDescriptor = {
	id: "lilim-fga",
	name: "SFA engine resource archive",
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
			source: "ArcFormats/Lilim/ArcFGA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Lilim/ArcAOS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `FgaOpener.TryOpen`. An FGA archive is a chain of 0x318-byte index blocks. Within a block,
 * records hold a name, a data offset and a size; a record whose first byte is `0xFF` continues the
 * index at the offset stored in its offset field, and a zero first byte ends the block.
 *
 * The reference rejects a continuation that does not move forward, which also prevents the chain from
 * looping back, and the port additionally bounds the number of blocks and entries so a damaged index
 * cannot allocate without limit. Entries named `*.scr` are Huffman-compressed; the port records the
 * unpacked size they declare and marks that size as a limit rather than an exact length.
 */
async function readFgaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	const entries: FixedEntry[] = [];
	let indexOffset = 0n;
	for (let block = 0; block < MAX_BLOCKS; block += 1) {
		if (indexOffset + BigInt(INDEX_BLOCK_SIZE) > source.size) return undefined;
		const buffer = await source.readAt(indexOffset, INDEX_BLOCK_SIZE);
		let position = 0;
		let chained = false;
		while (position < INDEX_BLOCK_SIZE) {
			const first = buffer[position] ?? 0;
			if (first === BLOCK_END) break;
			if (first === CHAIN_MARKER) {
				const next = BigInt(buffer.readUInt32LE(position + OFFSET_FIELD));
				if (next <= indexOffset || next >= source.size) return undefined;
				indexOffset = next;
				chained = true;
				break;
			}
			const name = decodeCStringField(buffer, position, NAME_SIZE);
			if (name.length === 0) return undefined;
			const offset = BigInt(buffer.readUInt32LE(position + OFFSET_FIELD));
			const storedSize = BigInt(buffer.readUInt32LE(position + SIZE_FIELD));
			if (!checkPlacement(offset, storedSize, source.size)) return undefined;
			if (entries.length >= MAX_ENTRIES) return undefined;
			const packed = sourceExtension(name) === PACKED_EXTENSION;
			let size = storedSize;
			let packedSize = storedSize;
			let metadata: Record<string, unknown> | undefined;
			if (packed && size >= BigInt(PACKED_HEADER_SIZE)) {
				const unpackedSize = (
					await source.readAt(offset, PACKED_HEADER_SIZE)
				).readUInt32LE(0);
				packedSize = size - BigInt(PACKED_HEADER_SIZE);
				size = BigInt(unpackedSize);
				metadata = { unpackedSize };
			}
			const entry: FixedEntry = createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
				packedSize,
				compressed: packed,
				...(metadata === undefined ? {} : { metadata }),
			});
			// GARbro wraps compressed entries in a limit stream, so the declared word is a bound.
			if (packed) entry.sizeKnown = false;
			entries.push(entry);
			position += RECORD_SIZE;
		}
		if (!chained) return entries;
	}
	return undefined;
}

/**
 * GARBro `AosOpener.OpenEntry`. A packed entry declares its unpacked size in its first four bytes and
 * holds a Huffman stream behind it; the decoder stops quietly at the end of that stream.
 */
async function openFgaEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.size);
	if (entry.size > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Packed entry exceeds the archive",
		);
	}
	const packed = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(entry.packedSize, "Huffman entry"),
	);
	return Readable.from([
		decompressHuffman(
			packed,
			bigintToBufferLength(entry.size, "Huffman output"),
		),
	]);
}

export const fgaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fgaDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readFgaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readFgaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FGA index layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openFgaEntry,
});
