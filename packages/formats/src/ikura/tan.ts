// Format reference: GARBro ArcFormats/Ikura/ArcTAN.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "tan";
const COUNT_OFFSET = 0;
const HEADER_SIZE = 2;
const FIRST_RECORD_SIZE = 4;
const METADATA_SIZE = 4;
/** Behind the metadata block GARbro skips a palette before the second count. */
const PALETTE_SIZE = 0x400;
const FRAME_RECORD_SIZE = 4;
const BPP = 8;

export const tanDescriptor: FormatDescriptor = {
	id: "ikura-tan",
	name: "D.O. animation resource",
	extensions: ["tan"],
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
			source: "ArcFormats/Ikura/ArcTAN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `TanOpener.TryOpen`. Only `.tan` files qualify. A 16-bit frame count sits at 0 and sizes
 * the first index, which GARbro skips. The image metadata follows with the width and height in 16-bit
 * fields, then a palette, then a second 16-bit count that sizes the frame offset table.
 *
 * Frame offsets are relative to the end of that table, and GARbro derives each frame size from the
 * next offset, letting the last frame run to the end of the file.
 */
async function readTanIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	let indexPosition = HEADER_SIZE + count * FIRST_RECORD_SIZE;
	if (BigInt(indexPosition + METADATA_SIZE) > source.size) return undefined;
	const metadata = await source.readAt(BigInt(indexPosition), METADATA_SIZE);
	const width = metadata.readUInt16LE(0);
	const height = metadata.readUInt16LE(2);

	indexPosition += METADATA_SIZE + PALETTE_SIZE;
	if (BigInt(indexPosition + 2) > source.size) return undefined;
	const frameCount = (
		await source.readAt(BigInt(indexPosition), 2)
	).readInt16LE(0);
	if (!isSaneCount(frameCount)) return undefined;
	indexPosition += 2;

	const baseOffset = BigInt(indexPosition + FRAME_RECORD_SIZE * frameCount);
	const indexSize = frameCount * FRAME_RECORD_SIZE;
	if (baseOffset > source.size) return undefined;
	const index = await source.readAt(BigInt(indexPosition), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < frameCount; id += 1) {
		const offset =
			baseOffset + BigInt(index.readUInt32LE(id * FRAME_RECORD_SIZE));
		if (offset > source.size) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(2, "0")}`),
			offset,
			size: 0n,
		});
		entry.metadata = { width, height, bpp: BPP };
		entries.push(entry);
	}
	for (const [position, entry] of entries.entries()) {
		const next = entries[position + 1]?.offset ?? source.size;
		const size = next - entry.offset;
		if (size < 0n || !checkPlacement(entry.offset, size, source.size))
			return undefined;
		entry.size = size;
		entry.packedSize = size;
	}
	return entries;
}

export const tanFormat: ArchiveFormat = defineFixedArchive({
	descriptor: tanDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readTanIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readTanIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid D.O. TAN layout");
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
