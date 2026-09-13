// Format reference: GARbro "ArcFormats/EmonEngine/ArcEME.cs", classes `EmeOpener`, `EmEntry`,
// `EmeArchive` and `EmMetaData`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss, inflateLzssAll } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
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

const INDEX_RECORD_SIZE = 0x60;
const KEY_SIZE = 40;
const COUNT_SIZE = 4;
const NAME_SIZE = 0x40;
const SCRIPT_SUBTYPE = 3;
const IMAGE_SUBTYPE = 4;
const T5_SUBTYPE = 5;
const SCRIPT_HEADER_SIZE = 12;

/**
 * `EmeOpener.ShiftValue`: the bits of `value` are spread by repeatedly adding the signed key to a shift
 * amount. C# masks shift counts to five bits, which the port reproduces.
 */
function shiftValue(value: number, key: number): number {
	let shift = 0;
	let result = 0;
	for (let bit = 0; bit < 32; bit += 1) {
		shift += key;
		result |= ((value >>> bit) & 1) << (shift & 31);
	}
	return result >>> 0;
}

/** `EmeOpener.InitTable`: a byte transposition with a wrapping step derived from the key. */
function initTable(
	data: Buffer,
	offset: number,
	length: number,
	key: number,
): void {
	const table = Buffer.alloc(length);
	let position = 0;
	for (let index = 0; index < length; index += 1) {
		position += key;
		while (position >= length) position -= length;
		if (position < 0) position = 0;
		table[position] = data[offset + index] ?? 0;
	}
	table.copy(data, offset);
}

/**
 * `EmeOpener.Decrypt`: an eight step bytecode kept in the first eight bytes of the key, each step using
 * the matching little endian word from the rest of the key.
 */
function decrypt(
	data: Buffer,
	offset: number,
	length: number,
	key: Buffer,
): void {
	const words = length >> 2;
	let keyIndex = key.length;
	for (let step = 7; step >= 0; step -= 1) {
		keyIndex -= 4;
		const word = key.readUInt32LE(keyIndex);
		const signed = word | 0;
		switch (key[step]) {
			case 1: {
				for (let index = 0; index < words; index += 1) {
					const position = offset + index * 4;
					data.writeUInt32LE(
						(data.readUInt32LE(position) ^ word) >>> 0,
						position,
					);
				}
				break;
			}
			case 2: {
				let chain = word;
				for (let index = 0; index < words; index += 1) {
					const position = offset + index * 4;
					const value = data.readUInt32LE(position);
					data.writeUInt32LE((value ^ chain) >>> 0, position);
					chain = value;
				}
				break;
			}
			case 4: {
				for (let index = 0; index < words; index += 1) {
					const position = offset + index * 4;
					data.writeUInt32LE(
						shiftValue(data.readUInt32LE(position), signed),
						position,
					);
				}
				break;
			}
			case 8:
				initTable(data, offset, length, signed);
				break;
			default:
				break;
		}
	}
}

interface EmeEntryInfo {
	name: string;
	offset: bigint;
	size: number;
	unpackedSize: number;
	subType: number;
	frameSize: number;
	frameInitPos: number;
}

interface EmeIndex {
	entries: EmeEntryInfo[];
	key: Buffer;
}

/** `EmeOpener.TryOpen`: a decrypt key, then a decrypted fixed size record per entry before the index. */
async function buildEmeIndex(
	source: ByteSource,
): Promise<EmeIndex | undefined> {
	if (source.size < BigInt(COUNT_SIZE + 8)) return undefined;
	const head = Buffer.from(await source.readAt(0n, 8));
	if (head.toString("latin1", 0, 8) !== "RREDATA ") return undefined;
	const count = Buffer.from(
		await source.readAt(source.size - BigInt(COUNT_SIZE), COUNT_SIZE),
	).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * INDEX_RECORD_SIZE;
	const indexOffset = source.size - BigInt(COUNT_SIZE) - BigInt(indexSize);
	if (indexOffset < BigInt(KEY_SIZE)) return undefined;
	const key = Buffer.from(
		await source.readAt(indexOffset - BigInt(KEY_SIZE), KEY_SIZE),
	);
	const index = Buffer.from(await source.readAt(indexOffset, indexSize));
	const entries: EmeEntryInfo[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * INDEX_RECORD_SIZE;
		decrypt(index, position, INDEX_RECORD_SIZE, key);
		const name = decodeCStringField(index, position, NAME_SIZE);
		const frameSize = index.readUInt16LE(position + 0x40);
		let frameInitPos = index.readUInt16LE(position + 0x42);
		if (frameSize !== 0) frameInitPos = (frameSize - frameInitPos) % frameSize;
		const subType = index.readInt32LE(position + 0x48);
		const size = index.readUInt32LE(position + 0x4c);
		const unpackedSize = index.readUInt32LE(position + 0x50);
		const offset = index.readUInt32LE(position + 0x54);
		if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
			return undefined;
		entries.push({
			name,
			offset: BigInt(offset),
			size,
			unpackedSize,
			subType,
			frameSize,
			frameInitPos,
		});
	}
	return { entries, key };
}

interface EntryMetadata {
	subType?: number;
	type?: string;
	frameSize?: number;
	frameInitPos?: number;
	unpackedSize?: number;
	key?: Buffer;
}

/** `EmeOpener.OpenScript`: a decrypted header plus either raw data or a two part LZSS stream. */
async function openScript(
	source: ByteSource,
	entry: FixedEntry,
	metadata: EntryMetadata,
): Promise<Readable> {
	const offset = entry.offset ?? 0n;
	const size = Number(entry.packedSize ?? entry.size);
	const key = metadata.key ?? Buffer.alloc(0);
	if (offset + BigInt(SCRIPT_HEADER_SIZE) > source.size)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated EME script header");
	const header = Buffer.from(await source.readAt(offset, SCRIPT_HEADER_SIZE));
	decrypt(header, 0, SCRIPT_HEADER_SIZE, key);
	const frameSize = metadata.frameSize ?? 0;
	if (frameSize === 0) {
		const data = Buffer.from(
			await source.readAt(offset + BigInt(SCRIPT_HEADER_SIZE), size),
		);
		return Readable.from([Buffer.concat([header, data])]);
	}
	const settings = {
		frameSize,
		frameInitPosition: metadata.frameInitPos ?? 0,
	};
	const unpackedSize = BigInt(metadata.unpackedSize ?? 0);
	const firstPart = header.readInt32LE(4);
	if (firstPart !== 0 && BigInt(firstPart) < unpackedSize) {
		const packedSize = header.readUInt32LE(0);
		const part1Size = Number(unpackedSize) - firstPart;
		const tail = Buffer.from(
			await source.readAt(
				offset + BigInt(SCRIPT_HEADER_SIZE + packedSize),
				size,
			),
		);
		const lead = Buffer.from(
			await source.readAt(offset + BigInt(SCRIPT_HEADER_SIZE), packedSize),
		);
		const part1 = inflateLzss(tail, {
			...settings,
			outputLength: part1Size,
		});
		const part2 = inflateLzss(lead, {
			...settings,
			outputLength: firstPart,
		});
		return Readable.from([
			Buffer.concat([Buffer.from(part1), Buffer.from(part2)]),
		]);
	}
	const data = Buffer.from(
		await source.readAt(offset + BigInt(SCRIPT_HEADER_SIZE), size),
	);
	// Without a part split the reference returns an unbounded stream, so the output length is whatever
	// the stream produces.
	return Readable.from([Buffer.from(inflateLzssAll(data, settings))]);
}

export const emonEmeDescriptor: FormatDescriptor = {
	id: "emon-eme",
	name: "Emon Engine resource archive",
	extensions: ["eme", "rre"],
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
			source: "ArcFormats/EmonEngine/ArcEME.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const emonEmeFormat: ArchiveFormat = defineFixedArchive({
	descriptor: emonEmeDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("RREDATA ", "latin1") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await buildEmeIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await buildEmeIndex(source);
		if (!index) throw new GarbroError("INVALID_ARCHIVE", "Invalid EME index");
		const fixed: FixedEntry[] = index.entries.map((entry, id) => {
			const metadata: EntryMetadata = {
				subType: entry.subType,
				frameSize: entry.frameSize,
				frameInitPos: entry.frameInitPos,
				unpackedSize: entry.unpackedSize,
				key: Buffer.from(index.key),
			};
			if (entry.subType === SCRIPT_SUBTYPE) metadata.type = "script";
			else if (entry.subType === IMAGE_SUBTYPE) metadata.type = "image";
			const isScript = entry.subType === SCRIPT_SUBTYPE;
			// Only scripts are rebuilt: the decrypted header sits in front of the decoded payload. Every
			// other entry is stored verbatim, even when the record claims a different unpacked size.
			// Without a frame size the reference prefixes the decrypted header to a read of the stored
			// size; otherwise the decoded payload replaces the whole entry.
			const size = isScript
				? entry.frameSize === 0
					? SCRIPT_HEADER_SIZE + entry.size
					: entry.unpackedSize
				: entry.size;
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(size),
				packedSize: BigInt(entry.size),
				compressed: isScript && entry.unpackedSize !== entry.size,
				encrypted: true,
				metadata: { ...metadata } as Record<string, unknown>,
			});
			return isScript ? { ...created, sizeKnown: false } : created;
		});
		return { entries: fixed, metadata: { entryCount: fixed.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = (entry.metadata ?? {}) as EntryMetadata;
		if (metadata.subType === SCRIPT_SUBTYPE)
			return openScript(source, entry, metadata);
		const offset = entry.offset ?? 0n;
		const size = Number(entry.size);
		if (metadata.subType === T5_SUBTYPE && size > 4) {
			const key = metadata.key ?? Buffer.alloc(0);
			const header = Buffer.from(await source.readAt(offset, 4));
			decrypt(header, 0, 4, key);
			const data = Buffer.from(await source.readAt(offset + 4n, size - 4));
			return Readable.from([Buffer.concat([header, data])]);
		}
		if (size === 0) return Readable.from([]);
		return Readable.from([Buffer.from(await source.readAt(offset, size))]);
	},
});
