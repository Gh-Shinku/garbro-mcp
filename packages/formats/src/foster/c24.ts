// Format reference: GARBro ArcFormats/Foster/ArcC24.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const C24_SIGNATURE = 0x00343243;
const C25_SIGNATURE = 0x00353243;
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const OFFSET_SIZE = 4;

export const c24Descriptor: FormatDescriptor = {
	id: "foster-c24",
	name: "Foster game engine multi-image",
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
			source: "ArcFormats/Foster/ArcC24.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const c25Descriptor: FormatDescriptor = {
	...c24Descriptor,
	id: "foster-c25",
};

/**
 * GARBro `C24Opener.TryOpen`. The signature is followed by a 32-bit frame count and one 32-bit data
 * offset per frame from 8; offsets outside the file are skipped. GARbro sorts the surviving frames
 * and derives each size from the next offset, with the last frame running to the end of the file.
 */
async function readFrames(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const signature = header.readUInt32LE(0);
	if (signature !== C24_SIGNATURE && signature !== C25_SIGNATURE)
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * OFFSET_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * OFFSET_SIZE));
		if (offset === 0n || offset > source.size) continue;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}@${String(id).padStart(4, "0")}`),
				offset,
				size: 0n,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	entries.sort((left, right) =>
		left.offset < right.offset ? -1 : left.offset > right.offset ? 1 : 0,
	);
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

export const c24Format: ArchiveFormat = defineFixedArchive({
	descriptor: c24Descriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x43, 0x32, 0x34, 0x00]) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		const signature = await source.readAt(0n, 4).catch(() => undefined);
		if (!signature || signature.readUInt32LE(0) !== C24_SIGNATURE) return false;
		return (await readFrames(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readFrames(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster C24 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});

export const c25Format: ArchiveFormat = defineFixedArchive({
	descriptor: c25Descriptor,
	detection: { signatures: [{ bytes: Buffer.from([0x43, 0x32, 0x35, 0x00]) }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		const signature = await source.readAt(0n, 4).catch(() => undefined);
		if (!signature || signature.readUInt32LE(0) !== C25_SIGNATURE) return false;
		return (await readFrames(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readFrames(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Foster C25 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
