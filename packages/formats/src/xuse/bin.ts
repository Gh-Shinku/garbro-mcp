// Format reference: GARbro ArcFormats/Xuse/ArcBIN.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const FIRST_OFFSET_OFFSET = 8;
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x10;
/** GARbro rejects offsets above `int.MaxValue`. */
const MAX_OFFSET = 0x80000000;

export const xuseBinDescriptor: FormatDescriptor = {
	id: "xuse-bin",
	name: "Xuse audio archive",
	extensions: ["bin", ""],
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
			source: "ArcFormats/Xuse/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `BinOpener.TryOpen`: the first data offset at 8 sizes the 0x10-byte records that start at
 * 4. A record holds the size at its start and the offset at +4; the walk stops at a zero offset and
 * rejects offsets that do not increase.
 *
 * GARbro assigns entry types from content signatures, so the port keeps the generated
 * `<archive>#<n>` stems without an extension.
 */
async function readXuseBinIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET_OFFSET + 4);
	const firstOffset = header.readUInt32LE(FIRST_OFFSET_OFFSET);
	if (
		firstOffset <= INDEX_OFFSET + RECORD_SIZE ||
		firstOffset >= MAX_OFFSET ||
		BigInt(firstOffset) >= source.size
	)
		return undefined;
	const indexSize = firstOffset - INDEX_OFFSET;
	if (indexSize % RECORD_SIZE !== 0) return undefined;
	const count = indexSize / RECORD_SIZE;
	if (count === 0) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	let lastOffset = 0n;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record + 4));
		if (offset === 0n) break;
		if (offset <= lastOffset) return undefined;
		const size = BigInt(index.readUInt32LE(record));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}`),
				offset,
				size,
			}),
		);
		lastOffset = offset;
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const xuseBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: xuseBinDescriptor,
	detection: {
		signatures: [{ bytes: Buffer.from([1, 0, 0, 0]) }],
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readXuseBinIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readXuseBinIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse audio archive");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
