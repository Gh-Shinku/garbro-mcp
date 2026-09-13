// Format reference: GARBro ArcFormats/Tanaka/ArcSMV.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("SMV1", "ascii");
const SIZE_OFFSET = 4;
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x40;
const HEADER_SIZE_OFFSET = 0x40;
const BPP_OFFSET = 0x4e;
/** GARbro reads the palette through `ImageFormat.ReadPalette`, which always consumes 0x400 bytes. */
const PALETTE_SIZE = 0x400;
const RECORD_SIZE = 8;
const SIZE_FIELD_OFFSET = 4;
const BPP = 8;

export const smvDescriptor: FormatDescriptor = {
	id: "will-smv",
	name: "Tanaka Tatsuhiro's engine animation resource",
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
			source: "ArcFormats/Tanaka/ArcSMV.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `SmvOpener.TryOpen`. The `SMV1` header repeats the file size at 4 and stores a frame count
 * at 8. The first frame header begins at 0x40 and its size field at 0x40 steps over the animated
 * header, whose depth field at 0x4e must be eight. Behind that header and a 0x400-byte palette come
 * the frame records, each holding an offset and a size. Frames are named `<archive>#<n padded to 2>`.
 */
async function readSmvIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (BigInt(header.readUInt32LE(SIZE_OFFSET)) !== source.size)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const headerSize = header.readUInt32LE(HEADER_SIZE_OFFSET);
	// The depth field lives inside the animation header, so the header must cover it.
	if (INDEX_OFFSET + headerSize < BPP_OFFSET + 4) return undefined;
	if (BigInt(BPP_OFFSET + 4) > source.size) return undefined;
	const bpp = (await source.readAt(BigInt(BPP_OFFSET), 4)).readInt32LE(0);
	if (bpp !== BPP) return undefined;

	const indexOffset = BigInt(INDEX_OFFSET + headerSize + 4 + PALETTE_SIZE);
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + SIZE_FIELD_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(2, "0")}`),
			offset,
			size,
		});
		entry.metadata = { bpp };
		entries.push(entry);
	}
	return entries;
}

export const smvFormat: ArchiveFormat = defineFixedArchive({
	descriptor: smvDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSmvIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSmvIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SMV animation layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
