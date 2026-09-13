// Format reference: GARBro ArcFormats/Cmvs/ArcCPZ2.cs, class `Cpz2Opener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { CPZ_LZSS_HEADER_SIZE, unpackCpzLzss } from "./cpz.js";

const SIGNATURE = Buffer.from("CPZ2", "ascii");
const EXTENSION = "cpz";
const COUNT_OFFSET = 4;
const INDEX_SIZE_OFFSET = 8;
const INDEX_KEY_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;
const RECORD_SIZE_OFFSET = 0;
const SIZE_OFFSET = 4;
const OFFSET_OFFSET = 8;
const ENTRY_KEY_OFFSET = 0x14;
const NAME_OFFSET = 0x18;
const COUNT_MASK = 0xe47c59f3;
const INDEX_SIZE_MASK = 0x3f71de2a;
const INDEX_KEY_MASK = 0x40de832c;
const ENTRY_KEY_MASK = 0x796c3afd;
const PSS_MARKER = Buffer.from("PSS0", "ascii");
const LZSS_UNPACKED_SIZE_OFFSET = 0x28;
/** The 32-bit stage subtracts this constant. */
const WORD_SUBTRACT = 0x15c3e7;
/** The trailing-byte stage adds this constant. */
const BYTE_ADD = 0x37;
const WORD_SIZE = 4;

const ENCRYPTION_TABLE = Uint32Array.from([
	0x3a68cdbf, 0xd3c3a711, 0x8414876e, 0x657befdb, 0xcdd7c125, 0x09328580,
	0x288ffedd, 0x99ebf13a, 0x5a471f95, 0x1ea3f4f1, 0xf4ff524e, 0xd358e8a9,
	0xc5b71015, 0xa913046f, 0x2d6fd2bd, 0x68c8be19,
]);

export const cpz2Descriptor: FormatDescriptor = {
	id: "cmvs-cpz2",
	name: "CVNS engine resource archive (version 2)",
	extensions: ["cpz"],
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
			source: "ArcFormats/Cmvs/ArcCPZ2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Cmvs/ArcCPZ.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function rotateRight(value: number, count: number): number {
	const shift = count & 0x1f;
	return ((value >>> shift) | (value << (32 - shift))) >>> 0;
}

/**
 * GARbro `Cpz2Opener.DecryptData`. The rotation comes from XORing the key's eight nibbles into a base
 * of five and adding eight. Whole words are XORed with a table entry plus the key, shifted down by
 * 0x15C3E7 and rotated right; up to three trailing bytes continue the same table walk, each one
 * XORed with the low bits of that sum and incremented by 0x37.
 */
export function decryptCpz2(data: Buffer, key: number): void {
	let shift = 5;
	let nibbles = key;
	for (let index = 0; index < 8; index += 1) {
		shift ^= nibbles & 0xf;
		nibbles >>>= 4;
	}
	shift += 8;

	let tableIndex = 0;
	const words = data.length >>> 2;
	for (let index = 0; index < words; index += 1) {
		const value =
			(data.readUInt32LE(index * WORD_SIZE) ^
				((ENCRYPTION_TABLE[tableIndex++ & 0xf] ?? 0) + key)) >>>
			0;
		data.writeUInt32LE(
			rotateRight((value - WORD_SUBTRACT) >>> 0, shift),
			index * WORD_SIZE,
		);
	}
	let byteShift = 0;
	for (let index = words * WORD_SIZE; index < data.length; index += 1) {
		const value =
			(data[index] ?? 0) ^
			(((ENCRYPTION_TABLE[tableIndex++ & 0xf] ?? 0) + key) >>> byteShift);
		data[index] = ((value & 0xff) + BYTE_ADD) & 0xff;
		byteShift += 4;
	}
}

/**
 * GARBro `Cpz2Opener.TryOpen`. Count, index size and index key are stored XORed with fixed masks. The
 * index is encrypted with the same transform as the payloads and holds variable-length records whose
 * own leading word is the record size, with the stored size at +4, the payload offset at +8, a
 * per-entry key at +0x14 and the name behind +0x18. Data offsets are relative to the end of the
 * index.
 *
 * Payloads that start with `PSS0` after decryption are LZSS-packed and carry their unpacked size at
 * +0x28, so the port exposes the final size while listing, exactly like the CPZ1 port.
 */
async function readCpz2Index(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readUInt32LE(COUNT_OFFSET) ^ COUNT_MASK;
	if (!isSaneCount(count)) return undefined;
	const indexSize =
		(header.readUInt32LE(INDEX_SIZE_OFFSET) ^ INDEX_SIZE_MASK) >>> 0;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const indexKey =
		(header.readUInt32LE(INDEX_KEY_OFFSET) ^ INDEX_KEY_MASK) >>> 0;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	decryptCpz2(index, indexKey);
	const baseOffset = BigInt(INDEX_OFFSET + indexSize);

	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + 4 > index.length) return undefined;
		const recordSize = index.readInt32LE(position);
		if (recordSize <= 0 || recordSize > index.length - position)
			return undefined;
		const nameOffset = position + NAME_OFFSET;
		if (nameOffset > index.length) return undefined;
		const terminator = index.indexOf(0, nameOffset);
		const nameEnd = terminator === -1 ? index.length : terminator;
		const name = decodeCp932(index.subarray(nameOffset, nameEnd));
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		const offset =
			baseOffset + BigInt(index.readUInt32LE(position + OFFSET_OFFSET));
		const key =
			(index.readUInt32LE(position + ENTRY_KEY_OFFSET) ^ ENTRY_KEY_MASK) >>> 0;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size,
			encrypted: true,
			metadata: { key },
		});
		const stored = await source.readAt(offset, Number(size));
		decryptCpz2(stored, key);
		if (
			stored.length >= CPZ_LZSS_HEADER_SIZE &&
			stored.subarray(0, PSS_MARKER.length).equals(PSS_MARKER)
		) {
			const unpackedSize = stored.readInt32LE(LZSS_UNPACKED_SIZE_OFFSET);
			if (unpackedSize >= 0) {
				entry.size = BigInt(CPZ_LZSS_HEADER_SIZE + unpackedSize);
				entry.compressed = true;
				entry.metadata = { key, lzss: true };
			}
		}
		entries.push(entry);
		position += recordSize;
	}
	return entries;
}

function cpz2Metadata(entry: FixedEntry): { key: number; lzss: boolean } {
	const metadata = entry.metadata ?? {};
	return {
		key: Number(metadata.key ?? 0),
		lzss: metadata.lzss === true,
	};
}

/** GARBro `Cpz2Opener.OpenEntry`: decrypt every payload and unpack the shared LZSS variant. */
const cpz2EntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.packedSize));
	decryptCpz2(payload, cpz2Metadata(entry).key);
	if (entry.compressed === true) return Readable.from([unpackCpzLzss(payload)]);
	return Readable.from([payload]);
};

export const cpz2Format: ArchiveFormat = defineFixedArchive({
	descriptor: cpz2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readCpz2Index(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readCpz2Index(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid CVNS CPZ2 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: cpz2EntryOpener,
});
