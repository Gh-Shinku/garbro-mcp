// Format reference: GARBro ArcFormats/Triangle/ArcBMX.cs, class `BmxOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { inflateTriLz } from "./tri-lz.js";

const COUNT_OFFSET = 0;
const FIRST_OFFSET_FIELD = 4;
/** The offset table holds one more entry than the count: a trailing end-of-file sentinel. */
const OFFSET_BIAS = 8;
/** GARbro XORs the packed size word with this mask. */
const SIZE_MASK = 0x65641538;
/** Packed payloads start with this marker and skip its eight bytes. */
const PACKED_MARKER = Buffer.from("fACE", "ascii");
const PACKED_HEADER_SIZE = 8;
/** Extensions whose archive-wide type GARbro sets without inspecting a payload. */
const DEFAULT_TYPES: Record<string, string> = { fx: "audio", gx: "image" };

export const triangleBmxDescriptor: FormatDescriptor = {
	id: "triangle-bmx",
	name: "Triangle resource archive",
	extensions: ["bmx", "wax", "fx", "gx"],
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
			source: "ArcFormats/Triangle/ArcBMX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `BmxOpener.TryOpen`. The header holds a signed entry count followed by `count + 1` offsets:
 * the first must equal the table size and the last must equal the file size, so the table describes a
 * gapless run of payloads. Entry names are `<archive>#<n padded to 4>`; archives named `fx` or `gx`
 * classify every entry as audio or image from the filename alone.
 *
 * `OpenEntry` sets the packed flag lazily when an entry starts with `fACE`, taking the unpacked size
 * from the following word after an XOR with 0x65641538 and decoding everything behind the eight-byte
 * header. The port performs the same inspection while reading the index so listing and extraction
 * agree, and leaves entries that are too short for the header verbatim.
 */
async function readBmxIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(OFFSET_BIAS)) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * 4 + OFFSET_BIAS;
	if (BigInt(indexSize) > source.size) return undefined;
	const table = await source.readAt(0n, indexSize);
	if (BigInt(table.readUInt32LE(FIRST_OFFSET_FIELD)) !== BigInt(indexSize))
		return undefined;
	if (BigInt(table.readUInt32LE(indexSize - 4)) !== source.size)
		return undefined;

	const name = basename(sourcePath);
	const extension = extname(name);
	const baseName =
		extension.length > 0 ? name.slice(0, -extension.length) : name;
	const defaultType = DEFAULT_TYPES[extension.slice(1).toLowerCase()];

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(FIRST_OFFSET_FIELD + id * 4));
		const nextOffset = BigInt(
			table.readUInt32LE(FIRST_OFFSET_FIELD + (id + 1) * 4),
		);
		const storedSize = nextOffset - offset;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		let size = storedSize;
		let packedSize = storedSize;
		let metadata: Record<string, unknown> | undefined = defaultType
			? { type: defaultType }
			: undefined;
		let compressed = false;
		if (storedSize >= BigInt(PACKED_HEADER_SIZE)) {
			const probe = await source.readAt(offset, PACKED_HEADER_SIZE);
			if (probe.subarray(0, PACKED_MARKER.length).equals(PACKED_MARKER)) {
				compressed = true;
				size = BigInt(probe.readUInt32LE(PACKED_MARKER.length) ^ SIZE_MASK);
				packedSize = storedSize - BigInt(PACKED_HEADER_SIZE);
				metadata = { ...metadata, packed: true };
			}
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${baseName}#${String(id).padStart(4, "0")}`,
				offset: compressed ? offset + BigInt(PACKED_HEADER_SIZE) : offset,
				size,
				packedSize,
				compressed,
				...(metadata === undefined ? {} : { metadata }),
			}),
		);
	}
	return entries;
}

/** GARbro `BmxOpener.OpenEntry`: unpacked `fACE` entries go through the Triangle LZ codec. */
const triangleEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Triangle entry"),
	);
	return Readable.from([
		inflateTriLz(stored, bigintToBufferLength(entry.size, "Triangle output")),
	]);
};

export const triangleBmxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: triangleBmxDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBmxIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readBmxIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Triangle BMX layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: triangleEntryOpener,
});
