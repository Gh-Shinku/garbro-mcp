// Format reference: GARbro "ArcFormats/Ellefin/ArcEPK.cs", classes `EpkOpener`, `EpkEntry`,
// `EpkInfo` and `EpkIndexReader`.
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
	decryptContent,
	decryptEntry,
	decryptIndex,
	rotateLeft,
	rotateRight,
	type EncryptionScheme,
} from "../lucifen/scheme.js";

const HEADER_SIZE = 8;
const SIGNATURE = "EPK";
const FLAG_ALIGNED_OFFSET = 0x01;
const FLAG_REQUIRED = 0x02;
const FLAG_WHOLE_CRYPT = 0x04;
const FLAG_ENCRYPTED = 0x08;
const FLAG_INDEX_ENCRYPTED = 0xf0;
const ALIGNED_SHIFT = 11;
const ENCRYPTED_HEAD_SIZE = 0x10;
const NAME_BUFFER_SIZE = 0x110;

/** The built in Ellefin scheme, which differs from the Lucifen defaults only in its constants. */
const EPK_SCHEME: EncryptionScheme = {
	baseKey: { key1: 0xa6bd375e, key2: 0x375d916b },
	contentXor: 0xd9,
	rotatePattern: 0x17236351,
};

interface EpkInfo {
	alignedOffset: boolean;
	isEncrypted: boolean;
	wholeCrypt: boolean;
	indexEncrypted: boolean;
	key: number;
	prefix?: Buffer;
}

interface EpkEntry {
	name: string;
	/** Index into the twelve byte record table; only the encrypted index uses it. */
	dirIndex: number;
	offset: number;
	size: number;
	unpackedSize: number;
	packed: boolean;
}

/** `EpkOpener.TryOpen`: the base name mixes the two keys with eight bit rotations. */
function deriveKeys(baseName: string): { arcKey: number; indexKey: number } {
	const bytes = encodeCp932(baseName);
	let arcKey = EPK_SCHEME.baseKey.key1;
	let indexKey = EPK_SCHEME.baseKey.key2;
	const back = bytes.length - 1;
	for (let i = 0; i < bytes.length; i += 1) {
		arcKey = (arcKey ^ (bytes[back - i] ?? 0)) >>> 0;
		indexKey = (indexKey ^ (bytes[i] ?? 0)) >>> 0;
		arcKey = rotateRight(arcKey, 8);
		indexKey = rotateLeft(indexKey, 8);
	}
	return { arcKey, indexKey };
}

interface ReadContext {
	index: Buffer;
	wideOffset: boolean;
	name: Buffer;
}

/** `EpkIndexReader.TraverseIndex`: the same letter tree as the Lucifen index. */
function traverseIndex(
	context: ReadContext,
	position: number,
	nameLength: number,
	entries: EpkEntry[],
): void {
	if (nameLength >= context.name.length) throw new Error("name too long");
	const { index } = context;
	let cursor = position;
	const count = index[cursor] ?? 0;
	cursor += 1;
	for (let i = 0; i < count; i += 1) {
		if (cursor + 1 + (context.wideOffset ? 4 : 2) > index.length)
			throw new Error("truncated letter table");
		const letter = index[cursor] ?? 0;
		cursor += 1;
		const nextOffset = context.wideOffset
			? index.readInt32LE(cursor)
			: index.readUInt16LE(cursor);
		cursor += context.wideOffset ? 4 : 2;
		if (letter === 0) {
			const name = decodeCp932(context.name.subarray(0, nameLength));
			entries.push({
				name,
				dirIndex: nextOffset,
				offset: 0,
				size: 0,
				unpackedSize: 0,
				packed: false,
			});
		} else {
			context.name[nameLength] = letter;
			traverseIndex(context, cursor + nextOffset, nameLength + 1, entries);
		}
	}
}

/** `EpkIndexReader.Read`: twelve byte records hold offset, stored size and unpacked size. */
function readEpkEntry(
	index: Buffer,
	position: number,
	info: EpkInfo,
	entry: EpkEntry,
): boolean {
	if (position < 0 || position + 12 > index.length) return false;
	let offset = index.readUInt32LE(position);
	let size = index.readUInt32LE(position + 4);
	const unpackedSize = index.readUInt32LE(position + 8);
	if (info.alignedOffset) {
		// The reference shifts both fields, which looks like a bug but is what it does.
		offset = offset * 2 ** ALIGNED_SHIFT;
		size = size * 2 ** ALIGNED_SHIFT;
	}
	entry.offset = offset;
	entry.size = size;
	entry.packed = unpackedSize !== 0;
	entry.unpackedSize = entry.packed ? unpackedSize : size;
	return true;
}

function parseEpkIndex(
	index: Buffer,
	count: number,
	info: EpkInfo,
): EpkEntry[] | undefined {
	const entries: EpkEntry[] = [];
	if (info.indexEncrypted) {
		let position = 4;
		const headerLength = index[position] ?? 0;
		position += 1;
		if (headerLength !== 0) {
			if (position + headerLength > index.length) return undefined;
			info.prefix = Buffer.from(
				index.subarray(position, position + headerLength),
			);
			position += headerLength;
		}
		const wideOffset = (index[position] ?? 0) !== 0;
		position += 1;
		const nameTreeLength = index.readInt32LE(position);
		position += 4;
		const entryTableOffset = position + nameTreeLength;
		const context: ReadContext = {
			index,
			wideOffset,
			name: Buffer.alloc(NAME_BUFFER_SIZE),
		};
		try {
			traverseIndex(context, position, 0, entries);
		} catch {
			return undefined;
		}
		if (entries.length !== count) return undefined;
		for (const entry of entries) {
			if (
				!readEpkEntry(
					index,
					entryTableOffset + entry.dirIndex * 12,
					info,
					entry,
				)
			)
				return undefined;
		}
	} else {
		let position = 4;
		for (let i = 0; i < count; i += 1) {
			if (position >= index.length) return undefined;
			const nameLength = index[position] ?? 0;
			position += 1;
			if (position + nameLength + 12 > index.length) return undefined;
			const name = decodeCp932(index.subarray(position, position + nameLength));
			position += nameLength;
			const entry: EpkEntry = {
				name,
				dirIndex: 0,
				offset: 0,
				size: 0,
				unpackedSize: 0,
				packed: false,
			};
			if (!readEpkEntry(index, position, info, entry)) return undefined;
			position += 12;
			entries.push(entry);
		}
	}
	return entries.length > 0 ? entries : undefined;
}

async function readEpkArchive(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: EpkEntry[]; info: EpkInfo } | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.toString("latin1", 0, 3) !== SIGNATURE) return undefined;
	const flags = header[3] ?? 0;
	if ((flags & FLAG_REQUIRED) === 0) return undefined;
	const fileName = (sourcePath.split(/[\\/]/).pop() ?? "").toUpperCase();
	if (fileName.length === 0) return undefined;
	const dot = fileName.lastIndexOf(".");
	const baseName = dot > 0 ? fileName.slice(0, dot) : fileName;
	const info: EpkInfo = {
		alignedOffset: (flags & FLAG_ALIGNED_OFFSET) !== 0,
		isEncrypted: (flags & FLAG_ENCRYPTED) !== 0,
		wholeCrypt: (flags & FLAG_WHOLE_CRYPT) !== 0,
		indexEncrypted: (flags & FLAG_INDEX_ENCRYPTED) !== 0,
		key: 0,
	};
	const keys = deriveKeys(baseName);
	info.key = keys.arcKey;
	let indexSize = header.readUInt32LE(4);
	if (info.indexEncrypted) indexSize = (indexSize ^ keys.indexKey) >>> 0;
	if (info.alignedOffset) indexSize = indexSize * 2 ** ALIGNED_SHIFT;
	// Only an encrypted index keeps the eight header bytes inside its length.
	if (!info.indexEncrypted || info.alignedOffset) indexSize -= HEADER_SIZE;
	if (indexSize < 0 || BigInt(indexSize) >= source.size) return undefined;
	if (BigInt(HEADER_SIZE) + BigInt(indexSize) > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	if (info.indexEncrypted)
		decryptIndex(index, index.length, keys.indexKey, EPK_SCHEME);
	const count = index.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const entries = parseEpkIndex(index, count, info);
	if (!entries) return undefined;
	for (const entry of entries) {
		if (!checkPlacement(BigInt(entry.offset), BigInt(entry.size), source.size))
			return undefined;
	}
	return { entries, info };
}

export const ellefinEpkDescriptor: FormatDescriptor = {
	id: "ellefin-epk",
	name: "Ellefin Game System resource archive",
	extensions: ["epk"],
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
			source: "ArcFormats/Ellefin/ArcEPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const ellefinEpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ellefinEpkDescriptor,
	// The reference registers the two "EPK" signature variants plus the always-try marker, so the
	// port leaves the candidate gate open and relies on its own detection.
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readEpkArchive(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readEpkArchive(source, sourcePath);
		if (!result) throw new GarbroError("INVALID_ARCHIVE", "Invalid EPK index");
		const { info } = result;
		const prefixLength = info.prefix?.length ?? 0;
		const entries: FixedEntry[] = result.entries.map((entry, id) => {
			// The prefix overwrites the head of the entry instead of extending it.
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: BigInt(entry.offset),
				size: BigInt(entry.unpackedSize),
				packedSize: BigInt(entry.size),
				compressed: entry.packed,
				encrypted: info.isEncrypted || info.wholeCrypt,
				metadata: {
					unpackedSize: entry.unpackedSize,
					prefixLength,
					wholeCrypt: info.wholeCrypt,
					isEncrypted: info.isEncrypted,
					key: info.key,
					...(info.prefix ? { prefix: info.prefix } : {}),
				},
			});
			return entry.packed ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				alignedOffset: info.alignedOffset,
				indexEncrypted: info.indexEncrypted,
				wholeCrypt: info.wholeCrypt,
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
		if (metadata?.wholeCrypt) decryptContent(output, EPK_SCHEME);
		if (metadata?.isEncrypted) {
			const head = Math.min(output.length, ENCRYPTED_HEAD_SIZE);
			if (head !== 0)
				decryptEntry(output, head, metadata?.key ?? 0, EPK_SCHEME);
		}
		const prefix = metadata?.prefix;
		// Ellefin copies the prefix over the first bytes of the entry.
		if (prefix && prefix.length <= output.length) prefix.copy(output, 0);
		return Readable.from([output]);
	},
});
