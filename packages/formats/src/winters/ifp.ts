// Format reference: GARbro ArcFormats/Winters/ArcIFP.cs
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

const SIGNATURE = 0x53474149;
const MARKER = Buffer.from("_IFP_01     ", "ascii");
const MARKER_OFFSET = 4;
const VERSION_OFFSET = 0x10;
const VERSION = 1;
const INDEX_SIZE_OFFSET = 0x18;
const INDEX_OFFSET = 0x20;
const RECORD_SIZE = 0x10;
const TYPE_OFFSET = 0;
const MASK_TYPE_OFFSET = 2;
const OFFSET_OFFSET = 4;
const SIZE_OFFSET = 8;
const MASK_SIZE_OFFSET = 12;
/** GARbro `ChangeType` extension for the known payload type codes. */
const TYPE_EXTENSIONS = new Map([
	[0x0b, "bmp"],
	[0x0c, "png"],
	[0x0d, "jpg"],
]);
/** Mask layers carry a fixed `.bmp` name. */
const MASK_TYPE_BMP = 0x0b;
const MASK_SUFFIX = "M.bmp";

export const ifpDescriptor: FormatDescriptor = {
	id: "winters-ifp",
	name: "Winters resource archive",
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
			source: "ArcFormats/Winters/ArcIFP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `IfpOpener.TryOpen`. The index size at 0x18 is a byte count that excludes a trailing
 * sentinel record, so the entry count is that size divided by 0x10 minus one. Records start at 0x20
 * with a type, a mask type, the data offset, the size, and the mask size. Zero-type records are
 * skipped, and a bitmap mask adds a second entry right behind the main payload.
 */
async function readIfpIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	if (
		!header
			.subarray(MARKER_OFFSET, MARKER_OFFSET + MARKER.length)
			.equals(MARKER)
	)
		return undefined;
	if (header.readInt32LE(VERSION_OFFSET) !== VERSION) return undefined;
	const count =
		Math.floor(header.readInt32LE(INDEX_SIZE_OFFSET) / RECORD_SIZE) - 1;
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const type = index.readUInt16LE(record + TYPE_OFFSET);
		if (type === 0) continue;
		const maskType = index.readUInt16LE(record + MASK_TYPE_OFFSET);
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const maskSize = BigInt(index.readUInt32LE(record + MASK_SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const stem = `${baseName}#${String(id).padStart(5, "0")}`;
		const extension = TYPE_EXTENSIONS.get(type);
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(
					extension === undefined ? stem : `${stem}.${extension}`,
				),
				offset,
				size,
			}),
		);
		if (maskType === MASK_TYPE_BMP && maskSize !== 0n) {
			const maskOffset = offset + size;
			if (!checkPlacement(maskOffset, maskSize, source.size)) return undefined;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(`${stem}${MASK_SUFFIX}`),
					offset: maskOffset,
					size: maskSize,
				}),
			);
		}
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const ifpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ifpDescriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x49, 0x41, 0x47, 0x53]) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readIfpIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIfpIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Winters IFP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
