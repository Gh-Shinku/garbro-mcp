// Format reference: GARbro Legacy/KApp/ArcCGD.cs
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

const SIGNATURE = Buffer.from("spiel100", "ascii");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x10;
const SIZE_OFFSET = 4;
const WIDTH_OFFSET = 8;
const HEIGHT_OFFSET = 0x0a;
const BPP_OFFSET = 0x0e;
const COMPRESSION_OFFSET = 0x0f;

export const cgdDescriptor: FormatDescriptor = {
	id: "kapp-cgd",
	name: "Spiel image collection",
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
			source: "Legacy/KApp/ArcCGD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `CgdOpener.TryOpen`. A `spiel100` header stores a 32-bit record count at 8 and records from
 * 0x10: the data offset, the stored size, the image size at +8, the bit depth at +0x0e, and the
 * compression method at +0x0f. Entries are named `<archive>#<n padded to 4>`.
 */
async function readCgdIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const width = index.readUInt16LE(record + WIDTH_OFFSET);
		const height = index.readUInt16LE(record + HEIGHT_OFFSET);
		const bpp = index[record + BPP_OFFSET] ?? 0;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}`),
				offset,
				size,
				metadata: {
					width,
					height,
					bpp,
					compression: index[record + COMPRESSION_OFFSET] ?? 0,
					unpackedSize: Math.floor((width * height * bpp) / 8),
				},
			}),
		);
	}
	return entries;
}

export const cgdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cgdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCgdIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCgdIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Spiel CGD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
