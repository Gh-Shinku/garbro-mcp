// Format reference: GARBro ArcFormats/Origin/ArcGAF.cs
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

const FILE_NAME = "gaf";
const WIDTH_OFFSET = 0;
const HEIGHT_OFFSET = 4;
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x0c;
const MAX_DIMENSION = 0x4000;
/** Frames are chains of two-byte records whose second byte adds to the pixel count. */
const STEP_SIZE = 2;
const COUNT_OFFSET_IN_STEP = 1;
const BPP = 8;

export const gafDescriptor: FormatDescriptor = {
	id: "origin-gaf",
	name: "origin engine bitmap archive",
	extensions: [""],
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
			source: "ArcFormats/Origin/ArcGAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `GafOpener.TryOpen`. The archive must be named `gaf` and stores the frame width and height
 * at 0 and 4 with a record count at 8. Frames start at 0x0c and are RLE chains: GARbro walks two-byte
 * steps, adding the second byte of each step to a pixel count, until it covers `width * height`, so
 * every frame's size follows from its own stream. The final frame runs to the end of the file.
 *
 * The port walks the streams in memory rather than one read per step, and exposes the stored
 * dimensions as entry metadata while extracting frames raw.
 */
async function readGafIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (basename(sourcePath).toLowerCase() !== FILE_NAME) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const width = header.readUInt32LE(WIDTH_OFFSET);
	const height = header.readUInt32LE(HEIGHT_OFFSET);
	if (
		width === 0 ||
		width > MAX_DIMENSION ||
		height === 0 ||
		height > MAX_DIMENSION
	)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const body = await source.readAt(
		BigInt(INDEX_OFFSET),
		Number(source.size - BigInt(INDEX_OFFSET)),
	);
	const imageSize = width * height;
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let offset = 0;
	for (let id = 0; id < count; id += 1) {
		const start = offset;
		if (id + 1 < count) {
			let pixels = 0;
			while (pixels < imageSize && offset < body.length) {
				pixels += body[offset + COUNT_OFFSET_IN_STEP] ?? 0;
				offset += STEP_SIZE;
			}
			if (pixels < imageSize) return undefined;
		} else {
			offset = body.length;
		}
		const size = BigInt(offset - start);
		const entryOffset = BigInt(INDEX_OFFSET + start);
		if (!checkPlacement(entryOffset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}`),
			offset: entryOffset,
			size,
		});
		entry.metadata = { width, height, bpp: BPP };
		entries.push(entry);
		offset = start + Number(size);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const gafFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gafDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readGafIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readGafIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid origin GAF layout");
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				width: entries[0]?.metadata?.width ?? 0,
				height: entries[0]?.metadata?.height ?? 0,
			},
		};
	},
});
