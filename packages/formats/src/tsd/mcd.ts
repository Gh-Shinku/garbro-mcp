// Format reference: GARBro Legacy/Tsd/ArcMCD.cs
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

const SIGNATURE = 0x20484c4f;
const MARKER = Buffer.from("for Win", "ascii");
const TRAILER_SIZE = 8;
const INDEX_OFFSET_FROM_END = 8;
const COUNT_FROM_END = 4;
const RECORD_SIZE = 8;
const BMP_MARKER = 0x4d42;
const RIFF_SIGNATURE = 0x46464952;

export const mcdDescriptor: FormatDescriptor = {
	id: "tsd-mcd",
	name: "TSD engine resource archive",
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
			source: "Legacy/Tsd/ArcMCD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `McdOpener.TryOpen`. The header starts with `OLH ` and the marker `for Win`, and a trailer
 * holds the index offset and a 32-bit record count in its last eight bytes. Records are eight bytes
 * with the data offset and the stored size; entries are named `<archive>#<n padded to 4>`.
 *
 * GARbro classifies entries from their leading signature and the port keeps that classification in
 * the entry metadata without changing any name.
 */
async function readMcdIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(TRAILER_SIZE)) return undefined;
	const header = await source.readAt(0n, 4 + MARKER.length);
	if (header.readUInt32LE(0) !== SIGNATURE) return undefined;
	if (!header.subarray(4, 4 + MARKER.length).equals(MARKER)) return undefined;
	const trailer = await source.readAt(
		source.size - BigInt(TRAILER_SIZE),
		TRAILER_SIZE,
	);
	const indexOffset = BigInt(trailer.readUInt32LE(0));
	const count = trailer.readInt32LE(COUNT_FROM_END);
	if (!isSaneCount(count) || indexOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(4, "0")}`),
			offset,
			size,
		});
		if (size >= 4n) {
			const signature = (await source.readAt(offset, 4)).readUInt32LE(0) >>> 0;
			const low = signature & 0xffff;
			if (low === 0 || low === BMP_MARKER) entry.metadata = { kind: "image" };
			else if (signature === RIFF_SIGNATURE) entry.metadata = { kind: "audio" };
		}
		entries.push(entry);
	}
	return entries;
}

export const mcdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mcdDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("OLH ", "ascii") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readMcdIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readMcdIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid TSD MCD layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
