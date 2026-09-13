// Format reference: GARBro Legacy/Pinpai/ArcARC.cs, class `ArcOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("arcx", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x10;
/** A record is a 0x10-byte name field followed by the stored size and the payload offset. */
const NAME_SIZE = 0x10;
const SIZE_FIELD = 0x10;
const OFFSET_FIELD = 0x14;
const RECORD_SIZE = 0x20;
/** Packed payloads start with the unpacked size word that precedes the LZSS stream. */
const PACKED_HEADER_SIZE = 4;
/** GARbro keeps `wav` archives stored; every other base name selects LZSS extraction. */
const STORED_BASE_NAME = "wav";

export const pinpaiArcxDescriptor: FormatDescriptor = {
	id: "pinpai-arcx",
	name: "Pinpai resource archive",
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
			source: "Legacy/Pinpai/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro compares `Path.GetFileNameWithoutExtension(file.Name).ToLowerInvariant()` with `wav`.
 * Windows-reported paths may arrive with either separator, so the port trims both.
 */
function isStoredArchive(sourcePath: string): boolean {
	const name = sourcePath.split(/[\\/]/).pop() ?? "";
	const extension = extname(name);
	const base = extension.length > 0 ? name.slice(0, -extension.length) : name;
	return base.toLowerCase() === STORED_BASE_NAME;
}

/**
 * Reads the fixed 0x20-byte index. Every archive except one named `wav` stores its payloads as LZSS
 * streams behind a four-byte unpacked size word, which the reference reads lazily in `OpenEntry`.
 * The port inspects that word while reading the index so listing and extraction agree, and marks the
 * entries as having an inexact size because the decoder stops at the end of the stored stream.
 */
async function readPinpaiIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const packed = !isStoredArchive(sourcePath);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		let size = storedSize;
		if (packed) {
			if (storedSize <= BigInt(PACKED_HEADER_SIZE)) return undefined;
			size = BigInt(
				(await source.readAt(offset, PACKED_HEADER_SIZE)).readUInt32LE(0),
			);
		}
		const normalized = normalizeEntryPath(name);
		const entry = createFixedEntry({
			id,
			...normalized,
			offset,
			size,
			packedSize: storedSize,
			compressed: packed,
		});
		if (packed) entry.sizeKnown = false;
		// GARbro resolves the name through its format catalog; `.b` entries are bitmaps.
		if (extname(normalized.path).toLowerCase() === ".b")
			entry.metadata = { type: "image" };
		entries.push(entry);
	}
	return entries;
}

/** GARbro `ArcOpener.OpenEntry`: `LzssStream` over everything behind the size word. */
const pinpaiEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		bigintToBufferLength(
			entry.packedSize - BigInt(PACKED_HEADER_SIZE),
			"Pinpai LZSS entry",
		),
	);
	return Readable.from([inflateLzssAll(stored)]);
};

export const pinpaiArcxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: pinpaiArcxDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readPinpaiIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readPinpaiIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Pinpai arcx layout");
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				compressed: !isStoredArchive(sourcePath),
			},
		};
	},
	openEntry: pinpaiEntryOpener,
});
