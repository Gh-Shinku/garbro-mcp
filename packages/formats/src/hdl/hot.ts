// Format reference: GARbro Legacy/Hdl/ArcHOT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { basename } from "node:path";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";
import { applySignatureResourceType } from "../shared/resource-catalog.js";

const SIGNATURE = 0x00544f48;
const RESERVED_OFFSET = 4;
const INDEX_OFFSET_OFFSET = 8;
const COUNT_OFFSET = 0x0c;
/** GARbro shifts every recorded offset by the 0x20-byte file header. */
const DATA_BIAS = 0x20;

export const hotDescriptor: FormatDescriptor = {
	id: "hdl-hot",
	name: "HDL engine resource archive",
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
			source: "Legacy/Hdl/ArcHOT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `HotOpener.TryOpen`. The offset table sits at the end of the file and every recorded value
 * points before it, shifted by 0x20. Sizes are derived from consecutive offsets, and the last entry
 * runs to the end of the table.
 *
 * GARbro derives entry types from payload signatures; the port keeps the generated stems because it
 * has no resource-type catalog.
 */
async function readHotIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	if (header.readUInt32LE(RESERVED_OFFSET) !== 0) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	if (indexOffset >= source.size) return undefined;
	const indexSize = count * 4;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const offsets: bigint[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readUInt32LE(id * 4)) + BigInt(DATA_BIAS);
		if (offset > indexOffset) return undefined;
		offsets.push(offset);
	}
	const end = indexOffset + BigInt(indexSize);
	const entries: FixedEntry[] = [];
	for (const [id, offset] of offsets.entries()) {
		const next = offsets[id + 1] ?? end;
		const size = next - offset;
		if (size < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(5, "0")}`),
			offset,
			size,
		});
		if (size >= 4n) {
			const probe = await source.readAt(offset, Number(size < 8n ? size : 8n));
			const signature = probe.readUInt32LE(0);
			if (
				(signature & 0x00ffffff) === 0x00544f48 &&
				probe.length >= 8 &&
				((probe[7] ?? 0) & 0x21) === 0x21
			)
				entry.resourceType = "image";
			else applySignatureResourceType(entry, signature);
		}
		entries.push(entry);
	}
	return entries;
}

export const hotFormat: ArchiveFormat = defineFixedArchive({
	descriptor: hotDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("HOT", "ascii") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readHotIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readHotIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid HDL HOT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
