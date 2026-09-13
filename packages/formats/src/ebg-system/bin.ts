// Format reference: GARBro Legacy/EbgSystem/ArcBIN.cs, class `BinOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** The reference only accepts the engine's fixed file name. */
const FILE_NAME = "0000.bin";
/** Every record is a fixed-size 640x480 15-bit bitmap. */
const BITMAP_SIZE = 0x96000;
const NAME_WIDTH = 4;

/**
 * GARBro `BinOpener.TryOpen`. The archive is a flat run of equally sized bitmaps and only opens when
 * the file is named `0000.bin` and its length is an exact multiple of the bitmap size. Entries are
 * numbered from zero and typed as images.
 *
 * The reference registers this opener inside a `#if DEBUG` block, so release builds of GARbro do not
 * offer it; the layout itself is unambiguous and is implemented here as listed.
 */
async function readEbgIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath ?? "").toLowerCase() !== FILE_NAME) return undefined;
	const bitmapSize = BigInt(BITMAP_SIZE);
	if (source.size === 0n || source.size % bitmapSize !== 0n) return undefined;
	const count = Number(source.size / bitmapSize);
	if (!isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${String(id).padStart(NAME_WIDTH, "0")}.bmp`),
				offset: BigInt(id) * bitmapSize,
				size: bitmapSize,
				packedSize: bitmapSize,
				metadata: { type: "image" },
			}),
		);
	}
	return entries;
}

/** The reference hands bitmaps to an image decoder; the archive layer emits the stored range. */
const ebgEntryOpener: FixedEntryOpener = async (source, entry) =>
	source.createReadStream(entry.offset, entry.packedSize);

export const ebgSystemBinDescriptor: FormatDescriptor = {
	id: "ebgsystem-bin",
	name: "EBG_SYSTEM bitmap archive",
	extensions: ["bin"],
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
			source: "Legacy/EbgSystem/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ebgSystemBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ebgSystemBinDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readEbgIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readEbgIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid EBG_SYSTEM layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: ebgEntryOpener,
});
