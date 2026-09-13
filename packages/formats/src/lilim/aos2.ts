// Format reference: GARBro ArcFormats/Lilim/ArcAOS.cs, class `Aos2Opener`.
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
import { openPackedHuffmanEntry } from "./packed.js";

const EXTENSION = "aos";
const INDEX_OFFSET = 0x111;
const BASE_OFFSET_FIELD = 4;
const INDEX_SIZE_FIELD = 8;
const RECORD_SIZE = 0x28;
const NAME_SIZE = 0x20;
const OFFSET_FIELD = 0x20;
const SIZE_FIELD = 0x24;
/** Entries with this extension hold a Huffman stream. */
const PACKED_EXTENSION = "scr";
/** Both packed kinds declare an unpacked size in front of the stream. */
const PACKED_HEADER_SIZE = 4;
/** These entries are packed as well, and become images under a new extension. */
const COMPRESSED_EXTENSION = "cmp";
const COMPRESSED_REPLACEMENT = "abm";

export const aos2Descriptor: FormatDescriptor = {
	id: "lilim-aos2",
	name: "LiLiM resource archive version 2",
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
			source: "ArcFormats/Lilim/ArcAOS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Aos2Opener.TryOpen`. The first word is zero, the base offset sits at 4 and the index size at
 * 8, and the index itself starts at 0x111. GARbro requires the index to end inside the file and the
 * base offset to sit behind it, then reads `index_size / 0x28` records holding a CP932 name, a data
 * offset and a size.
 *
 * `*.scr` entries hold a Huffman stream, and `*.cmp` entries do as well but are renamed to `*.abm` and
 * classified as images; the reference applies that rename in the directory, and the port mirrors it so
 * listing and extraction agree.
 */
async function readAos2Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readInt32LE(0) !== 0) return undefined;
	const baseOffset = BigInt(header.readUInt32LE(BASE_OFFSET_FIELD));
	const indexSize = header.readInt32LE(INDEX_SIZE_FIELD);
	if (indexSize <= 0 || indexSize % RECORD_SIZE !== 0) return undefined;
	if (baseOffset >= source.size) return undefined;
	if (BigInt(INDEX_OFFSET + indexSize) >= source.size) return undefined;
	if (baseOffset < BigInt(INDEX_OFFSET + indexSize)) return undefined;
	const count = indexSize / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const storedName = decodeCStringField(index, record, NAME_SIZE);
		if (storedName.length === 0) return undefined;
		const offset =
			baseOffset + BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const extension = sourceExtension(storedName);
		const packed =
			extension === PACKED_EXTENSION || extension === COMPRESSED_EXTENSION;
		// Packed entries declare their unpacked size in the payload, which bounds the output.
		let size = storedSize;
		let packedSize = storedSize;
		if (packed && storedSize >= BigInt(PACKED_HEADER_SIZE)) {
			size = BigInt(
				(await source.readAt(offset, PACKED_HEADER_SIZE)).readUInt32LE(0),
			);
			packedSize = storedSize - BigInt(PACKED_HEADER_SIZE);
		}
		let name = storedName;
		let metadata: Record<string, unknown> | undefined;
		if (extension === COMPRESSED_EXTENSION) {
			name = storedName.replace(/\.[^.]*$/, `.${COMPRESSED_REPLACEMENT}`);
			metadata = { inferredType: "image" };
		}
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
			packedSize: storedSize,
			compressed: packed,
			...(metadata === undefined ? {} : { metadata }),
		});
		if (packed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

export const aos2Format: ArchiveFormat = defineFixedArchive({
	descriptor: aos2Descriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readAos2Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAos2Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AOS version 2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (!entry.compressed)
			return source.createReadStream(entry.offset, entry.size);
		return openPackedHuffmanEntry(source, entry);
	},
});
