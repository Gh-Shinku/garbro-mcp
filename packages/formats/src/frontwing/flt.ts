// Format reference: GARBro ArcFormats/FrontWing/ArcFLT.cs, class `FltOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { createZlibInflateStream } from "@garbro-mcp/codecs";
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

/** 'LIB_PACKDATA0000' */
const SIGNATURE = Buffer.from("LIB_PACKDATA0000", "latin1");
const COUNT_FIELD = 0x14;
const ENCRYPTED_FIELD = 0x1c;
const INDEX_START = 0x100;
const RECORD_SIZE = 0x100;
/** A name is UTF-16, so its length is counted in code units up to this limit. */
const NAME_LIMIT = 0xe8;
const COMPRESSION_FIELD = 0xea;
const ENTRY_ENCRYPTED_FIELD = 0xeb;
const SIZE_FIELD = 0xf0;
const UNPACKED_SIZE_FIELD = 0xf4;
const OFFSET_FIELD = 0xf8;
/** Compression 1 marks a zlib stream. */
const COMPRESSION_ZLIB = 1;

interface FltMetadata extends Record<string, unknown> {
	/** The record's compression method. */
	compression: number;
	/** Whether the payload is exclusive-ored with the key derived from its offset. */
	encrypted: boolean;
	/** The key byte, derived from the payload offset. */
	key?: number;
}

function fltMetadata(entry: FixedEntry): FltMetadata {
	const metadata = entry.metadata ?? {};
	return {
		compression: Number(metadata.compression ?? 0),
		encrypted: metadata.encrypted === true,
		...(metadata.key === undefined ? {} : { key: Number(metadata.key) }),
	};
}

/**
 * GARBro `FltEntry.Key`: every byte of the payload offset folded together. The offset is a 64-bit value,
 * so the port folds the whole bigint.
 */
function offsetKey(offset: bigint): number {
	let key = offset & 0xffn;
	for (let shift = 8n; shift < 64n; shift += 8n)
		key ^= (offset >> shift) & 0xffn;
	return Number(key & 0xffn);
}

/**
 * GARBro `FltOpener.TryOpen`. The index is a run of 0x100-byte records behind a 0x100-byte header, and the
 * whole index is substituted through a 256-byte table when the header's encryption word is one. Names are
 * UTF-16 and end at the first pair of zero bytes.
 */
async function readFltIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const encryptedIndex = header.readInt32LE(ENCRYPTED_FIELD) === 1;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_START + indexSize) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_START), indexSize),
	);
	if (encryptedIndex)
		for (let position = 0; position < index.length; position += 1)
			index[position] = DEFAULT_NAME_KEY[index[position] ?? 0] ?? 0;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		let nameLength = 0;
		while (nameLength < NAME_LIMIT) {
			if (
				(index[record + nameLength] ?? 0) === 0 &&
				(index[record + nameLength + 1] ?? 0) === 0
			)
				break;
			nameLength += 2;
		}
		if (nameLength === 0) return undefined;
		const name = index
			.subarray(record, record + nameLength)
			.toString("utf16le");
		const compression = index[record + COMPRESSION_FIELD] ?? 0;
		const encrypted = (index[record + ENTRY_ENCRYPTED_FIELD] ?? 0) === 1;
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const offset = index.readBigInt64LE(record + OFFSET_FIELD);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const compressed = compression === COMPRESSION_ZLIB;
		const metadata: FltMetadata = {
			compression,
			encrypted,
			...(encrypted ? { key: offsetKey(offset) } : {}),
		};
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: compressed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed,
				encrypted,
				metadata,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARBro `FltOpener.OpenEntry`: an encrypted payload is exclusive-ored with the byte folded from its own
 * offset first, and a zlib stream is inflated behind that.
 */
const fltEntryOpener: FixedEntryOpener = async (source, entry) => {
	const { encrypted, key } = fltMetadata(entry);
	let stream: Readable;
	if (!encrypted) {
		stream = source.createReadStream(entry.offset, entry.packedSize);
	} else {
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		for (let position = 0; position < data.length; position += 1)
			data[position] = (data[position] ?? 0) ^ (key ?? 0);
		stream = Readable.from([data]);
	}
	return entry.compressed ? createZlibInflateStream(stream) : stream;
};

/** GARBro `FltOpener.DefaultNameKey`, a 256-byte substitution table for encrypted indexes. */
const DEFAULT_NAME_KEY = Buffer.from([
	0x00, 0x16, 0xc9, 0x4a, 0x91, 0x04, 0x5e, 0x20, 0x33, 0x14, 0x4b, 0x8a, 0x0a,
	0x70, 0x9f, 0x36, 0xaf, 0x0d, 0x93, 0xb0, 0x2b, 0xfe, 0x29, 0x72, 0x94, 0x99,
	0x9b, 0xed, 0xce, 0xc4, 0xf1, 0xf4, 0x9c, 0x1b, 0xe0, 0x02, 0x87, 0x82, 0x47,
	0xdf, 0xf3, 0xa9, 0xdc, 0xef, 0x3b, 0xb9, 0xc5, 0x83, 0xd8, 0x0f, 0x9a, 0xe2,
	0xbd, 0x28, 0x9e, 0xab, 0xb7, 0x3f, 0x75, 0x63, 0x2a, 0x5d, 0x05, 0x4e, 0x1f,
	0xcf, 0x61, 0xaa, 0x10, 0x77, 0xcc, 0x90, 0xd5, 0x43, 0xa6, 0xec, 0x88, 0x08,
	0x97, 0x7a, 0xf5, 0x42, 0xba, 0x3a, 0xf6, 0x7d, 0x8f, 0xb5, 0x18, 0x76, 0x40,
	0x6d, 0xac, 0x19, 0x1d, 0x4d, 0x38, 0x03, 0x8c, 0x01, 0x7b, 0xe7, 0xb3, 0x2f,
	0x67, 0xf8, 0x6a, 0x13, 0xad, 0xf0, 0x5b, 0x7c, 0x24, 0x6b, 0xc6, 0xc0, 0x06,
	0x89, 0x71, 0xdd, 0x23, 0x11, 0x09, 0x1a, 0xf9, 0xc2, 0x31, 0xb1, 0xbe, 0x8b,
	0x6e, 0xfa, 0x48, 0x52, 0xda, 0x17, 0x21, 0xd9, 0x60, 0x78, 0xa4, 0xa8, 0x26,
	0x79, 0x5c, 0x41, 0xbf, 0xd4, 0x3c, 0x1e, 0x86, 0xa7, 0x6f, 0xb8, 0x2c, 0xd2,
	0x57, 0x56, 0x58, 0x66, 0xe4, 0xca, 0x55, 0x44, 0xe8, 0x85, 0x53, 0x96, 0x7f,
	0x68, 0xc7, 0x73, 0x4c, 0xe6, 0x12, 0xb6, 0x98, 0xbc, 0xae, 0xee, 0xa0, 0xfc,
	0x69, 0x62, 0xc1, 0xe3, 0xb2, 0x95, 0xe9, 0x46, 0xcd, 0xd0, 0x50, 0x15, 0x9d,
	0x51, 0x30, 0x5a, 0x64, 0xf7, 0x8e, 0x07, 0xbb, 0xc8, 0xa2, 0x3e, 0xd3, 0x39,
	0xa5, 0x49, 0x5f, 0x3d, 0xd1, 0xcb, 0x0e, 0x54, 0xc3, 0x4f, 0x8d, 0x84, 0xdb,
	0x2d, 0x0b, 0xd7, 0x92, 0x7e, 0xe1, 0xeb, 0x81, 0xfd, 0x25, 0xea, 0x2e, 0xb4,
	0xd6, 0x37, 0xa1, 0xe5, 0x6c, 0x1c, 0x22, 0x45, 0xf2, 0x65, 0x74, 0x34, 0x35,
	0xde, 0x59, 0x27, 0xa3, 0xfb, 0x0c, 0x80, 0x32, 0xff,
]);

export const frontWingFltDescriptor: FormatDescriptor = {
	id: "frontwing-flt",
	name: "FrontWing resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/FrontWing/ArcFLT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const frontWingFltFormat: ArchiveFormat = defineFixedArchive({
	descriptor: frontWingFltDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFltIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readFltIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid FrontWing FLT layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: fltEntryOpener,
});
