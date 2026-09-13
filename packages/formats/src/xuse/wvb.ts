// Format reference: GARBro ArcFormats/Xuse/ArcWVB.cs
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const FIRST_OFFSET_OFFSET = 4;
const RECORD_SIZE = 8;
const SIZE_OFFSET = 0;
const OFFSET_OFFSET = 4;
/** GARbro prepends a 16-byte RIFF header to every payload. */
const WAV_HEADER_SIZE = 16;
const DATA_MARKER = Buffer.from("data", "ascii");
/** The data marker sits four bytes behind the fmt chunk. */
const DATA_MARKER_BIAS = 4;

export const wvbDescriptor: FormatDescriptor = {
	id: "xuse-wvb",
	name: "Xuse audio resource archive",
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
			source: "ArcFormats/Xuse/ArcWVB.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `WvbOpener.TryOpen`. The word at 4, minus one, is the data start and also sizes the
 * index: eight-byte records with the stored size and the data offset. The walk stops at a zero
 * offset, and a `data` marker behind the fmt chunk validates the layout.
 *
 * GARbro builds a 16-byte RIFF header on extraction, which the port folds into the entry size so
 * the declared length stays verifiable.
 */
async function readWvbIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(FIRST_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET_OFFSET + 4);
	const firstOffset = header.readInt32LE(FIRST_OFFSET_OFFSET) - 1;
	if (firstOffset < RECORD_SIZE || BigInt(firstOffset) >= source.size)
		return undefined;
	if ((firstOffset & (RECORD_SIZE - 1)) !== 0) return undefined;
	const count = firstOffset / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	if (BigInt(firstOffset + 4) > source.size) return undefined;
	const fmtSize = BigInt(
		(await source.readAt(BigInt(firstOffset), 4)).readUInt32LE(0),
	);
	const markerOffset = BigInt(firstOffset) + fmtSize + BigInt(DATA_MARKER_BIAS);
	if (markerOffset + BigInt(DATA_MARKER.length) > source.size) return undefined;
	const marker = await source.readAt(markerOffset, DATA_MARKER.length);
	if (!marker.equals(DATA_MARKER)) return undefined;

	const index = await source.readAt(0n, count * RECORD_SIZE);
	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const stored = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		if (offset === 0n) break;
		// The stored size covers eight bytes that GARbro never reads.
		if (stored < BigInt(RECORD_SIZE) || offset < 1n) break;
		const packed = stored - BigInt(RECORD_SIZE);
		const entryOffset = offset - 1n;
		if (!checkPlacement(entryOffset, packed, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(`${baseName}#${String(id).padStart(2, "0")}`),
			offset: entryOffset,
			size: packed + BigInt(WAV_HEADER_SIZE),
			packedSize: packed,
			compressed: true,
		});
		entry.metadata = { generatedWavHeader: true };
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARbro `WvbOpener.OpenEntry`: a 16-byte RIFF header in front of the raw payload. */
const wvbEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	const header = Buffer.alloc(WAV_HEADER_SIZE);
	header.writeUInt32LE(0x46464952, 0); // 'RIFF'
	header.writeUInt32LE(Number(entry.size) - 8, 4);
	header.writeUInt32LE(0x45564157, 8); // 'WAVE'
	header.writeUInt32LE(0x20746d66, 12); // 'fmt '
	return Readable.from([header, payload]);
};

export const wvbFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wvbDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readWvbIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readWvbIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Xuse WVB layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: wvbEntryOpener,
});
