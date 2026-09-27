// Format reference: GARbro "Legacy/Discovery/ArcDAT.cs", classes `DatOpener`, `BDataEntry`,
// `EDataEntry` and the `Decrypt`/`Descramble32`/`Descramble8` helpers.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss, inflateLzssAll } from "@garbro-mcp/codecs";
import { writeBmp8Palette, writeBmp24 } from "../shared/bmp.js";
import { basename } from "node:path";
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

/** The entry count is the last little endian word of the file. */
const COUNT_SIZE = 4;
const B_DATA_ENTRY_SIZE = 0x3c;
const E_DATA_ENTRY_SIZE = 0x2c;
const V_DATA_ENTRY_SIZE = 0x20;
const B_DATA_NAME_OFFSET = 0x18;
const E_DATA_NAME_OFFSET = 0x1c;
const V_DATA_NAME_OFFSET = 0x10;
const V_DATA_XOR = 0xde;
/** `Decrypt` chains two scramblers and a final byte mask. */
const SCRAMBLE_WORD_SEED = 13;
const SCRAMBLE_BYTE_SEED = 7;
const SCRAMBLE_XOR = 0xd6;

interface DiscoveryEntry {
	path: string;
	rawPath?: string;
	offset: bigint;
	size: bigint;
	/** Bytes stored before the payload, used by packed EData headers. */
	headerSize: bigint;
	headerUnpacked: bigint;
	bodyOffset: bigint;
	bodySize: bigint;
	/** Unpacked size declared by the index. */
	unpackedSize: bigint;
	packed: boolean;
	kind: "bdata" | "edata" | "vdata";
	/** `BDataEntry`: the counts of the picture of the entry, of its own record. */
	width: number;
	height: number;
	bpp: number;
	isMask: boolean;
	extra: number;
	colors: number;
}

/**
 * `DatOpener.Descramble32`: a bit permutation over the little endian words in place. The loop walks
 * the word backwards, gathering each bit at a position shifted by the seed until it lands at zero.
 */
function descrambleWords(
	data: Buffer,
	offset: number,
	length: number,
	seed: number,
): void {
	const words = Math.floor(length / 4);
	for (let index = 0; index < words; index += 1) {
		const position = offset + index * 4;
		const original = data.readUInt32LE(position);
		let collected = (original & ~1) >>> 0;
		let walk = 0;
		let shift = 0;
		for (let step = 0; step < 31; step += 1) {
			shift = walk - seed;
			if (shift < 0) shift += ((31 - shift) >> 5) * 32;
			const bit = (collected & ((1 << shift) >>> 0)) >>> 0;
			const rest = (collected & ~bit) >>> 0;
			const moved =
				shift <= walk
					? (bit << (walk - shift)) >>> 0
					: (bit >>> (shift - walk)) >>> 0;
			collected = (moved | rest) >>> 0;
			walk = shift;
		}
		data.writeUInt32LE((collected | ((original & 1) << shift)) >>> 0, position);
	}
}

/** `DatOpener.Descramble8`: a single cycle of the byte permutation `i = (x - seed) mod length`. */
function descrambleBytes(
	data: Buffer,
	offset: number,
	length: number,
	seed: number,
): void {
	const first = data[offset] ?? 0;
	let x = 0;
	let i = 0;
	for (let count = length - 1; count > 0; count -= 1) {
		i = x - seed;
		while (i < 0) i += length;
		data[offset + x] = data[offset + i] ?? 0;
		x = i;
	}
	data[offset + i] = first;
}

/** `DatOpener.Decrypt`: both scramblers followed by a byte mask. */
function decrypt(data: Buffer, offset: number, length: number): void {
	descrambleWords(data, offset, length, SCRAMBLE_WORD_SEED);
	descrambleBytes(data, offset, length, SCRAMBLE_BYTE_SEED);
	for (let index = 0; index < length; index += 1)
		data[offset + index] = (data[offset + index] ?? 0) ^ SCRAMBLE_XOR;
}

function kindOf(sourcePath: string): "bdata" | "edata" | "vdata" | undefined {
	const name = basename(sourcePath).toLowerCase();
	if (name.startsWith("bdata")) return "bdata";
	if (name.startsWith("edata")) return "edata";
	if (name.startsWith("vdata")) return "vdata";
	return undefined;
}

/** `DatOpener.TryOpen` dispatches on the file name prefix; every index sits before the count. */
async function readDiscoveryIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<DiscoveryEntry[] | undefined> {
	const kind = kindOf(sourcePath);
	if (!kind) return undefined;
	if (source.size < BigInt(COUNT_SIZE + 4)) return undefined;
	const tail = Buffer.from(await source.readAt(source.size - 4n, COUNT_SIZE));
	const count = tail.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const entrySize =
		kind === "bdata"
			? B_DATA_ENTRY_SIZE
			: kind === "edata"
				? E_DATA_ENTRY_SIZE
				: V_DATA_ENTRY_SIZE;
	const nameOffset =
		kind === "bdata"
			? B_DATA_NAME_OFFSET
			: kind === "edata"
				? E_DATA_NAME_OFFSET
				: V_DATA_NAME_OFFSET;
	const indexSize = count * entrySize;
	if (BigInt(indexSize + COUNT_SIZE) >= source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(source.size - 4n - BigInt(indexSize), indexSize),
	);
	if (kind === "vdata") {
		for (let position = 0; position < index.length; position += 1)
			index[position] = (index[position] ?? 0) ^ V_DATA_XOR;
	}
	const entries: DiscoveryEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		const position = i * entrySize;
		if (kind !== "vdata") decrypt(index, position, entrySize);
		const nameLength = index[position] ?? 0;
		if (nameLength === 0 || nameLength > entrySize - nameOffset)
			return undefined;
		const name = decodeCStringField(index, position + nameOffset, nameLength);
		const record = { ...normalizeEntryPath(name) };
		const entry: DiscoveryEntry = {
			...record,
			offset: 0n,
			size: 0n,
			headerSize: 0n,
			headerUnpacked: 0n,
			bodyOffset: 0n,
			bodySize: 0n,
			unpackedSize: 0n,
			packed: false,
			kind,
			width: 0,
			height: 0,
			bpp: 0,
			isMask: false,
			extra: 0,
			colors: 0,
		};
		if (kind === "bdata") {
			const stored = BigInt(index.readUInt32LE(position + 4));
			const unpacked = BigInt(index.readUInt32LE(position + 8));
			entry.offset = BigInt(index.readUInt32LE(position + 0xc));
			entry.size = stored;
			entry.unpackedSize = unpacked;
			// The reference marks the entry packed when the two sizes differ.
			entry.packed = stored !== unpacked;
			entry.width = index.readUInt32LE(position + 0x10);
			entry.height = index.readUInt32LE(position + 0x14);
			entry.bpp = index.readUInt8(position + 1);
			entry.isMask = index.readUInt8(position + 2) === 1;
			entry.extra = index.readUInt16LE(position + 0x28);
			entry.colors = index.readUInt16LE(position + 0x2a);
		} else if (kind === "edata") {
			entry.bodySize = BigInt(index.readUInt32LE(position + 4));
			entry.headerUnpacked = BigInt(index.readUInt32LE(position + 0x14));
			entry.bodyOffset = BigInt(index.readUInt32LE(position + 0xc));
			entry.headerSize = BigInt(index.readUInt32LE(position + 0x10));
			entry.offset = BigInt(index.readUInt32LE(position + 0x18));
			entry.size = entry.headerSize + entry.bodySize;
			entry.unpackedSize =
				entry.headerUnpacked + BigInt(index.readUInt32LE(position + 8));
			// EData bodies are always compressed.
			entry.packed = true;
		} else {
			entry.size = BigInt(index.readUInt32LE(position + 8));
			entry.offset = BigInt(index.readUInt32LE(position + 0xc));
			entry.unpackedSize = entry.size;
		}
		if (!checkPlacement(entry.offset, entry.size, source.size))
			return undefined;
		entries.push(entry);
	}
	return entries;
}

export const discoveryDatDescriptor: FormatDescriptor = {
	id: "discovery-dat",
	name: "Discovery resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Discovery/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** The places of a colour to a pixel the walks of this engine hand over, of the counts of a record. */
const BDATA_PLACES = 4;
/** A picture of one place of a colour stands of grey, which the engine reads as `Gray8`. */
function greyColourMap(): Buffer {
	const entries = Buffer.alloc(256 * 4);
	for (let level = 0; level < 256; level += 1) {
		entries[level * 4] = level;
		entries[level * 4 + 1] = level;
		entries[level * 4 + 2] = level;
	}
	return entries;
}

/**
 * The rows of a picture of a frame stand bottom up in the file where the picture stands of
 * `ImageData.CreateFlipped`, which stands of every picture of this engine but one of a covering place.
 */
function flipBDataRows(
	pixels: Buffer,
	width: number,
	height: number,
	places: number,
): Buffer {
	const stride = width * places;
	const rows = Buffer.alloc(stride * height);
	for (let row = 0; row < height; row += 1) {
		pixels.copy(
			rows,
			row * stride,
			(height - 1 - row) * stride,
			(height - row) * stride,
		);
	}
	return rows;
}

/**
 * `BDataDecoder`: the places of a picture of a bdata entry stand behind a colour map and a count of places of
 * the file, of the counts of the record of the entry; the places of a picture of the engine stand of rows whose
 * count of places of a colour stands of the whole of a word of four places, which this project takes off before
 * writing a bitmap. A picture of one place of a colour stands of a covering place and keeps the order of the file,
 * where every other picture stands of `ImageData.CreateFlipped`.
 */
async function readBDataPicture(
	source: ByteSource,
	entry: FixedEntry,
	metadata: Record<string, unknown>,
): Promise<Buffer> {
	const width = Number(metadata.width ?? 0);
	const height = Number(metadata.height ?? 0);
	const bpp = Number(metadata.bitsPerPixel ?? 0);
	const isMask = metadata.isMask === true;
	const colors = Number(metadata.colors ?? 0);
	const extra = Number(metadata.extra ?? 0);
	if (width <= 0 || height <= 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of no places of the file`,
		);
	}
	// The reference stands of three places of a colour for every count of the record but one of eight and one
	// of a covering place, whose counts stand against the stride it hands over.
	if (!isMask && 8 !== bpp && 24 !== bpp) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`The picture ${entry.path} stands of ${bpp} places of a colour`,
		);
	}
	const places = isMask || 8 === bpp ? 1 : 3;
	const stored = Buffer.from(
		await source.readAt(entry.offset, Number(entry.packedSize)),
	);
	let at = 0;
	let palette: Buffer | undefined;
	if (colors > 0) {
		at += colors * BDATA_PLACES;
		palette = stored.subarray(0, colors * BDATA_PLACES);
	}
	if (extra > 0) at += 10 * extra + 2;
	if (at > stored.length) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of too few places of the file`,
		);
	}
	// `BDataDecoder` stands of a count of places of four to a row of the file.
	const strideBytes = (width * places + 3) & ~3;
	const rows = Buffer.alloc(strideBytes * height);
	if (entry.compressed) {
		const unpacked = inflateLzss(stored.subarray(at), {
			outputLength: strideBytes * height,
		});
		unpacked.copy(rows);
	} else {
		stored.copy(rows, 0, at, at + rows.length);
	}
	if (rows.length < strideBytes * height) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`The picture ${entry.path} stands of too few places of its picture`,
		);
	}
	// The rows stand of the whole of a word of four places in the file, which a bitmap of this project does not.
	const pixels = Buffer.alloc(width * height * places);
	for (let row = 0; row < height; row += 1) {
		rows.copy(
			pixels,
			row * width * places,
			row * strideBytes,
			row * strideBytes + width * places,
		);
	}
	if (isMask) {
		return writeBmp8Palette(width, height, pixels, greyColourMap());
	}
	if (8 === bpp) {
		return writeBmp8Palette(width, height, pixels, palette ?? Buffer.alloc(0));
	}
	return writeBmp24(width, height, flipBDataRows(pixels, width, height, 3));
}

export const discoveryDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: discoveryDatDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDiscoveryIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const parsed = await readDiscoveryIndex(source, sourcePath);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Discovery layout");
		const entries: FixedEntry[] = parsed.map((entry, index) => {
			const metadata: Record<string, unknown> = {
				kind: entry.kind,
				packed: entry.packed,
				unpackedSize: entry.unpackedSize.toString(),
			};
			if (entry.kind === "bdata") {
				metadata.type = "image";
				metadata.width = entry.width;
				metadata.height = entry.height;
				metadata.bitsPerPixel = entry.bpp;
				metadata.isMask = entry.isMask;
				metadata.colors = entry.colors;
				metadata.extra = entry.extra;
			}
			if (entry.kind === "edata") {
				metadata.headerSize = entry.headerSize.toString();
				metadata.headerUnpacked = entry.headerUnpacked.toString();
				metadata.bodyOffset = entry.bodyOffset.toString();
				metadata.bodySize = entry.bodySize.toString();
			}
			const created = createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: entry.offset,
				size: entry.unpackedSize,
				packedSize: entry.size,
				// The reference marks an EData entry packed always and a BData entry packed where its two
				// counts differ, and both stand of the same walk of the compressed streams.
				compressed: entry.kind === "edata" || entry.packed,
				encrypted: false,
				metadata,
			});
			// Only the EData header length is known up front; the body decodes to its own end.
			return entry.kind === "edata"
				? { ...created, sizeKnown: false }
				: created;
		});
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = (entry.metadata ?? {}) as {
			kind?: string;
			headerSize?: string;
			headerUnpacked?: string;
			bodyOffset?: string;
			bodySize?: string;
		};
		if (metadata.kind === "bdata") {
			return Readable.from([await readBDataPicture(source, entry, metadata)]);
		}
		if (metadata.kind !== "edata")
			return Readable.from([
				Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
			]);
		const headerSize = Number(metadata.headerSize ?? "0");
		const headerUnpacked = Number(metadata.headerUnpacked ?? "0");
		const bodyOffset = BigInt(metadata.bodyOffset ?? "0");
		const bodySize = Number(metadata.bodySize ?? "0");
		const header = inflateLzss(
			Buffer.from(await source.readAt(entry.offset, headerSize)),
			{ outputLength: headerUnpacked },
		);
		const body = inflateLzssAll(
			Buffer.from(await source.readAt(bodyOffset, bodySize)),
		);
		return Readable.from([header, body]);
	},
});
