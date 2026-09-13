// Format reference: GARbro "ArcFormats/Lucifen/ArcLPK.cs", classes `LpkOpener`, `LuciArchive`,
// `LpkInfo` and `IndexReader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	encodeCp932,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	DEFAULT_SCHEME,
	decryptContent,
	decryptEntry,
	decryptIndex,
	rotateLeft,
	rotateRight,
	type EncryptionScheme,
	type LpkKey,
} from "./scheme.js";

const SIGNATURE = "LPK1";
const HEADER_SIZE = 8;
const INDEX_SIZE_MASK = 0xffffff;
const ALIGNED_SHIFT = 11;
const FLAG_ALIGNED_OFFSET = 0x01;
const FLAG_REQUIRED = 0x02;
const FLAG_ENCRYPTED = 0x04;
const FLAG_PACKED_ENTRIES = 0x08;
const FLAG_WHOLE_CRYPT = 0x10;
const NAME_BUFFER_SIZE = 260;
const ENCRYPTED_HEAD_SIZE = 0x100;

interface LpkInfo {
	alignedOffset: boolean;
	isEncrypted: boolean;
	packedEntries: boolean;
	wholeCrypt: boolean;
	key: number;
	prefix?: Buffer;
}

interface LpkEntry {
	name: string;
	offset: number;
	size: number;
	unpackedSize: number;
	packed: boolean;
	flag: number;
}

/** `LpkOpener.Open`: derives the archive keys from the upper case base name. */
function deriveKeys(baseKey: LpkKey, baseName: Buffer): LpkKey {
	let key1 = baseKey.key1 >>> 0;
	let key2 = baseKey.key2 >>> 0;
	for (
		let head = 0, tail = baseName.length - 1;
		tail >= 0;
		head += 1, tail -= 1
	) {
		key1 = (key1 ^ (baseName[tail] ?? 0)) >>> 0;
		key2 = (key2 ^ (baseName[head] ?? 0)) >>> 0;
		key1 = rotateRight(key1, 7);
		key2 = rotateLeft(key2, 7);
	}
	return { key1, key2 };
}

/** `IndexReader.Read`: a prefix tree of single letters over a flat entry table. */
function readLpkIndex(index: Buffer, info: LpkInfo): LpkEntry[] | undefined {
	const count = index.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	let position = 4;
	const prefixLength = index[position] ?? 0;
	position += 1;
	if (prefixLength !== 0) {
		if (position + prefixLength > index.length) return undefined;
		info.prefix = Buffer.from(
			index.subarray(position, position + prefixLength),
		);
		position += prefixLength;
	}
	const nameWidth = (index[position] ?? 0) !== 0 ? 4 : 2;
	position += 1;
	const letterTableLength = index.readInt32LE(position);
	position += 4;
	const entriesOffset = position + letterTableLength;
	if (entriesOffset >= index.length) return undefined;
	let entrySize = info.packedEntries ? 13 : 9;
	const available = Math.trunc((index.length - entriesOffset) / count);
	if (available < entrySize) entrySize = available;
	if (entrySize < 8 || (info.packedEntries && entrySize < 12)) return undefined;
	const name = Buffer.alloc(NAME_BUFFER_SIZE);
	const entries: LpkEntry[] = [];
	const addEntry = (nameLength: number, entryNumber: number): boolean => {
		if (nameLength < 1) return false;
		const entryPosition = entriesOffset + entrySize * entryNumber;
		if (entryPosition + entrySize > index.length) return false;
		let cursor = entryPosition;
		let flag = 0;
		// An odd entry size carries a flag byte in front of the offset.
		if ((entrySize & 1) !== 0) {
			flag = index[cursor] ?? 0;
			cursor += 1;
		}
		const rawOffset = index.readUInt32LE(cursor);
		const size = index.readUInt32LE(cursor + 4);
		let unpackedSize = size;
		let packed = false;
		if (info.packedEntries) {
			const declared = index.readUInt32LE(cursor + 8);
			packed = declared !== 0;
			if (packed) unpackedSize = declared;
		}
		entries.push({
			name: decodeCp932(name.subarray(0, nameLength)),
			offset: info.alignedOffset ? rawOffset * 2 ** ALIGNED_SHIFT : rawOffset,
			size,
			unpackedSize,
			packed,
			flag,
		});
		return true;
	};
	const traverse = (offset: number, nameLength: number): boolean => {
		if (offset < 0 || offset >= index.length) return false;
		if (nameLength >= name.length) return false;
		let cursor = offset;
		const nodeCount = index[cursor] ?? 0;
		cursor += 1;
		for (let i = 0; i < nodeCount; i += 1) {
			if (cursor + 1 + nameWidth > index.length) return false;
			const letter = index[cursor] ?? 0;
			cursor += 1;
			const nextOffset =
				nameWidth === 4
					? index.readInt32LE(cursor)
					: index.readUInt16LE(cursor);
			cursor += nameWidth;
			name[nameLength] = letter;
			if (letter !== 0) {
				if (!traverse(cursor + nextOffset, nameLength + 1)) return false;
			} else if (!addEntry(nameLength, nextOffset)) {
				return false;
			}
		}
		return true;
	};
	if (!traverse(position, 0)) return undefined;
	return entries.length === count ? entries : undefined;
}

interface LpkArchiveInfo {
	info: LpkInfo;
	scheme: EncryptionScheme;
}

async function readLpkArchive(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: LpkEntry[]; archive: LpkArchiveInfo } | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.toString("latin1", 0, 4) !== SIGNATURE) return undefined;
	const fileName = (sourcePath.split(/[\\/]/).pop() ?? "").toUpperCase();
	if (fileName.length === 0) return undefined;
	const dot = fileName.lastIndexOf(".");
	const baseName = encodeCp932(dot > 0 ? fileName.slice(0, dot) : fileName);
	const scheme = DEFAULT_SCHEME;
	const derived = deriveKeys(scheme.baseKey, baseName);
	const code = (header.readUInt32LE(4) ^ derived.key2) >>> 0;
	const flags = code >>> 24;
	// Bit one selects the only index layout the reference supports.
	if ((flags & FLAG_REQUIRED) === 0) return undefined;
	let indexSize = code & INDEX_SIZE_MASK;
	const alignedOffset = (flags & FLAG_ALIGNED_OFFSET) !== 0;
	if (alignedOffset) indexSize = (indexSize << ALIGNED_SHIFT) - HEADER_SIZE;
	if (indexSize < 5 || BigInt(indexSize) >= source.size) return undefined;
	if (BigInt(HEADER_SIZE) + BigInt(indexSize) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	decryptIndex(index, indexSize, derived.key2, scheme);
	const info: LpkInfo = {
		alignedOffset,
		isEncrypted: (flags & FLAG_ENCRYPTED) !== 0,
		packedEntries: (flags & FLAG_PACKED_ENTRIES) !== 0,
		wholeCrypt: (flags & FLAG_WHOLE_CRYPT) !== 0,
		key: derived.key1,
	};
	const entries = readLpkIndex(index, info);
	if (!entries) return undefined;
	for (const entry of entries) {
		if (!checkPlacement(BigInt(entry.offset), BigInt(entry.size), source.size))
			return undefined;
	}
	// Patch archives set the whole crypt bit without encrypting their content.
	if (info.wholeCrypt && baseName.toString("latin1") === "PATCH")
		info.wholeCrypt = false;
	return { entries, archive: { info, scheme } };
}

export const lucifenLpkDescriptor: FormatDescriptor = {
	id: "lucifen-lpk",
	name: "Lucifen system resource archive",
	extensions: ["lpk"],
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
			source: "ArcFormats/Lucifen/ArcLPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const lucifenLpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lucifenLpkDescriptor,
	detection: { signatures: [{ bytes: Buffer.from(SIGNATURE, "latin1") }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readLpkArchive(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readLpkArchive(source, sourcePath);
		if (!result) throw new GarbroError("INVALID_ARCHIVE", "Invalid LPK index");
		const archive = result.archive.info;
		const prefixLength = archive.prefix?.length ?? 0;
		const entries: FixedEntry[] = result.entries.map((entry, id) => {
			// A zero sized entry is an empty stream in the reference, prefix or not.
			const empty = entry.size === 0 && !entry.packed;
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: BigInt(entry.offset),
				size: BigInt(empty ? 0 : entry.unpackedSize + prefixLength),
				packedSize: BigInt(entry.size),
				compressed: entry.packed,
				encrypted: archive.isEncrypted || archive.wholeCrypt,
				metadata: {
					unpackedSize: entry.unpackedSize,
					prefixLength,
					flag: entry.flag,
					wholeCrypt: archive.wholeCrypt,
					isEncrypted: archive.isEncrypted,
					key: archive.key,
					...(archive.prefix ? { prefix: archive.prefix } : {}),
				},
			});
			return entry.packed && !empty
				? { ...created, sizeKnown: false }
				: created;
		});
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				alignedOffset: archive.alignedOffset,
				packedEntries: archive.packedEntries,
				wholeCrypt: archive.wholeCrypt,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.packedSize === 0n) return Readable.from([]);
		const metadata = entry.metadata as
			| {
					unpackedSize?: number;
					wholeCrypt?: boolean;
					isEncrypted?: boolean;
					key?: number;
					prefix?: Buffer;
			  }
			| undefined;
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		const unpackedSize = metadata?.unpackedSize ?? stored.length;
		const data = entry.compressed ? inflateLzssAll(stored) : stored;
		const output = Buffer.alloc(unpackedSize);
		data.copy(output, 0, 0, Math.min(data.length, unpackedSize));
		if (metadata?.wholeCrypt) decryptContent(output, DEFAULT_SCHEME);
		if (metadata?.isEncrypted) {
			const head = Math.min(output.length, ENCRYPTED_HEAD_SIZE);
			if (head !== 0)
				decryptEntry(output, head, metadata?.key ?? 0, DEFAULT_SCHEME);
		}
		const prefix = metadata?.prefix;
		return Readable.from([prefix ? Buffer.concat([prefix, output]) : output]);
	},
});
