// Format reference: GARBro ArcFormats/Musica/ArcSQZ.cs
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

const SIGNATURE = Buffer.from("SQZ1", "ascii");
const COUNT_OFFSET = 0x10;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0c;
const INDEX_OFFSET = 0x14;
const RECORD_SIZE = 8;
const SIZE_OFFSET = 4;
/** GARbro doubles the stored value to obtain the frame count. */
const COUNT_FACTOR = 2;
const BPP = 32;

export const sqzDescriptor: FormatDescriptor = {
	id: "musica-sqz",
	name: "Musica engine animated frames",
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
			source: "ArcFormats/Musica/ArcSQZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `SqzOpener.TryOpen`. The `SQZ1` signature carries the frame width and height, and the value
 * at 0x10 is half the frame count. Frames follow as 8-byte records with an offset and a size, and are
 * named `<archive>#<n padded to 4>`.
 */
async function readSqzIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET) * COUNT_FACTOR;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const metadata = {
		width: header.readUInt32LE(WIDTH_OFFSET),
		height: header.readUInt32LE(HEIGHT_OFFSET),
		bpp: BPP,
	};
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}`),
			offset,
			size,
		});
		entry.metadata = { ...metadata };
		entries.push(entry);
	}
	return entries;
}

export const sqzFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sqzDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSqzIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSqzIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Musica SQZ layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
