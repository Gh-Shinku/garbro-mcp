// Format reference: GARbro "Legacy/Kurumi/ArcMPK.cs", class `MpkOpener` (the `MpkCompression` codec
// behind the packed flag is not ported yet; unpacked indices and payloads are fully handled).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("MP", "latin1");
const VERSION_OFFSET = 2;
const MAX_VERSION = 1;
const COUNT_OFFSET = 4;
const DATA_OFFSET_OFFSET = 8;
const HEADER_SIZE = 12;
/** Both the index and every payload start with a nine byte block: big endian size, flag, filler. */
const BLOCK_HEADER_SIZE = 9;
const BLOCK_SIZE_OFFSET = 0;
const BLOCK_FLAG_OFFSET = 8;
const NAME_SIZE = 0xf8;
const RECORD_SIZE = NAME_SIZE + 12;

interface MpkEntry {
	path: string;
	rawPath?: string;
	offset: number;
	size: number;
	unpackedSize: number;
}

async function readExact(
	source: ByteSource,
	offset: number,
	size: number,
): Promise<Buffer | undefined> {
	try {
		const data = Buffer.from(await source.readAt(BigInt(offset), size));
		return data.length === size ? data : undefined;
	} catch {
		return undefined;
	}
}

/**
 * GARbro `MpkOpener.Decompress`: a big endian unpacked size, a flag that selects the compression,
 * and then the stored bytes. Packed blocks need the `MpkCompression` codec and are declined here.
 */
async function readBlock(
	source: ByteSource,
	offset: number,
): Promise<Buffer | undefined> {
	const header = await readExact(source, offset, BLOCK_HEADER_SIZE);
	if (!header) return undefined;
	if ((header[BLOCK_FLAG_OFFSET] ?? 0) !== 0) return undefined;
	const unpackedSize = header.readUInt32BE(BLOCK_SIZE_OFFSET) >>> 0;
	if (unpackedSize === 0) return undefined;
	return await readExact(source, offset + BLOCK_HEADER_SIZE, unpackedSize);
}

/** GARbro `MpkOpener.TryOpen`, which lists the directory out of the decompressed index. */
async function readMpkLayout(
	source: ByteSource,
): Promise<MpkEntry[] | undefined> {
	const header = await readExact(source, 0, HEADER_SIZE);
	if (!header) return undefined;
	if (!header.subarray(0, 2).equals(SIGNATURE)) return undefined;
	if ((header[VERSION_OFFSET] ?? 0) > MAX_VERSION) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = header.readUInt32LE(DATA_OFFSET_OFFSET) >>> 0;
	if (dataOffset <= HEADER_SIZE || BigInt(dataOffset) >= source.size)
		return undefined;
	const index = await readBlock(source, HEADER_SIZE);
	if (!index) return undefined;
	if (index.length < count * RECORD_SIZE) return undefined;
	const entries: MpkEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * RECORD_SIZE;
		const rawName = decodeCStringField(index, position, NAME_SIZE);
		const entry: MpkEntry = {
			...normalizeEntryPath(rawName),
			offset: (index.readUInt32LE(position + NAME_SIZE) + dataOffset) >>> 0,
			size: index.readUInt32LE(position + NAME_SIZE + 4) >>> 0,
			unpackedSize: index.readUInt32LE(position + NAME_SIZE + 8) >>> 0,
		};
		if (!checkPlacement(BigInt(entry.offset), BigInt(entry.size), source.size))
			return undefined;
		entries.push(entry);
	}
	return entries.length > 0 ? entries : undefined;
}

export const kurumiMpkDescriptor: FormatDescriptor = {
	id: "kurumi-mpk",
	name: "Kurumi resource archive",
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
			source: "Legacy/Kurumi/ArcMPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kurumiMpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kurumiMpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMpkLayout(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const layout = await readMpkLayout(source);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi MPK layout");
		const entries: FixedEntry[] = layout.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: BigInt(entry.offset),
				size: BigInt(entry.size),
				// The reference marks every entry packed and decompresses it on extraction.
				compressed: true,
				metadata: {
					unpackedSize: entry.unpackedSize,
				} as Record<string, unknown>,
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const header = await readExact(
			source,
			Number(entry.offset),
			BLOCK_HEADER_SIZE,
		);
		if (!header)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi MPK block");
		if ((header[BLOCK_FLAG_OFFSET] ?? 0) !== 0) {
			// The packed flavour needs the `MpkCompression` codec, which is not ported yet, so the
			// stored block is passed through unchanged.
			return Readable.from([
				Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
			]);
		}
		const unpackedSize = header.readUInt32BE(BLOCK_SIZE_OFFSET) >>> 0;
		const data = await readExact(
			source,
			Number(entry.offset) + BLOCK_HEADER_SIZE,
			unpackedSize,
		);
		if (!data)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Kurumi MPK payload");
		return Readable.from([data]);
	},
});
