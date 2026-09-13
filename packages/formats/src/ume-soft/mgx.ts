// Format reference: GARBro ArcFormats/UMeSoft/ArcMGX.cs, class `MgxOpener`.
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

/** The signature spells `MGX` and ends with a 0x1A byte. */
const SIGNATURE = Buffer.from([0x4d, 0x47, 0x58, 0x1a]);
const EXTENSION = "grx";
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const OFFSET_SIZE = 4;
const FRAME_DIGITS = 4;
const FRAME_EXTENSION = "GRX";

export const mgxDescriptor: FormatDescriptor = {
	id: "umeseoft-mgx",
	name: "U-Me Soft multi-frame image",
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
			source: "ArcFormats/UMeSoft/ArcMGX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `MgxOpener.TryOpen`. The signature spells `MGX` and ends with a 0x1A byte, the frame count sits
 * at 4, and the index that follows is nothing but one offset per frame. Frames carry no names of their
 * own: the reference builds them from the archive name as a four-digit index with an upper-case `GRX`
 * extension.
 *
 * Sizes are derived from consecutive offsets with the last frame running to the end of the file, which the
 * reference computes without a placement check on the derived spans, while the port validates each one.
 * An offset beyond the file rejects the archive, and frames are extracted verbatim because the frame
 * decode is an image concern.
 */
async function readMgxIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * OFFSET_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");

	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * OFFSET_SIZE));
		if (offset > source.size) return undefined;
		offsets.push(offset);
	}

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = offsets[id] ?? 0n;
		const next = offsets[id + 1] ?? source.size;
		if (next < offset) return undefined;
		const size = next - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const name = `${baseName}#${String(id).padStart(FRAME_DIGITS, "0")}.${FRAME_EXTENSION}`;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: { inferredType: "image" },
			}),
		);
	}
	return entries;
}

export const mgxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mgxDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMgxIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMgxIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid U-Me Soft MGX layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
