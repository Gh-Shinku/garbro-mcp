// Format reference: GARBro ArcFormats/Leaf/ArcA.cs, classes `AOpener` and `ALeafEntry`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	bigintToBufferLength,
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
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** The reference compares the first 16-bit word with `0xAF1E`. */
const SIGNATURE_VALUE = 0xaf1e;
const SIGNATURE_SIZE = 2;
const COUNT_FIELD = 2;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x17;
const KEY_FIELD = 0x17;
const SIZE_FIELD = 0x18;
const OFFSET_FIELD = 0x1c;
const HEADER_SIZE = 4;
/** Packed entries store a four-byte unpacked size in front of the LZSS stream. */
const PACKED_PREFIX_SIZE = 4;
/** Keys in this range trigger the reference's alpha fix-up, which needs a real image header. */
const DECRYPT_KEY_MIN = 0x7f;
const DECRYPT_KEY_MAX = 0x89;
const DECRYPT_MIN_SIZE = 0x20;
/** The fix-up only runs for 32-bit images, whose pixels start after the 0x20-byte header. */
const IMAGE_HEADER_SIZE = 0x20;
const IMAGE_TYPE_INDEXED = 1;
const IMAGE_BITS_32 = 0x20;

interface LeafAMetadata extends Record<string, unknown> {
	/** The record's key byte; the low nibble drives the alpha fix-up. */
	key: number;
}

function leafAMetadata(entry: FixedEntry): LeafAMetadata {
	const metadata = entry.metadata ?? {};
	return { key: Number(metadata.key ?? 0) };
}

/** 32-bit wrap-around arithmetic, matching C#'s unchecked `uint` operations. */
function wrap32(value: bigint): number {
	return Number(value & 0xffffffffn);
}

/**
 * GARbro `AOpener.Decrypt`. For 32-bit images the reference turns pre-multiplied BGRA pixels into
 * straight alpha by accumulating `channel + alpha - key` per pixel from the first pixel block. The
 * loop always writes `b, g, r, 0`, and the four accumulators wrap as single bytes.
 */
function fixupAlpha(data: Buffer, length: number, key: number): Buffer {
	if (length < IMAGE_HEADER_SIZE) return data;
	const width = BigInt(data.readUInt32LE(0));
	const height = BigInt(data.readUInt32LE(4));
	const imageSize = wrap32(width * height);
	const type = data.readUInt16LE(0x10);
	const bits = data.readUInt16LE(0x12);
	if (
		type !== IMAGE_TYPE_INDEXED ||
		bits !== IMAGE_BITS_32 ||
		imageSize === 0 ||
		Number(BigInt(IMAGE_HEADER_SIZE) + BigInt(imageSize) * 4n) > length
	)
		return data;

	let red = 0;
	let green = 0;
	let blue = 0;
	let position = IMAGE_HEADER_SIZE;
	for (let index = 0; index < imageSize; index += 1) {
		if (position + 3 >= data.length) break;
		const alpha = data[position + 3] ?? 0;
		blue = (blue + (data[position] ?? 0) + alpha - key) & 0xff;
		green = (green + (data[position + 1] ?? 0) + alpha - key) & 0xff;
		red = (red + (data[position + 2] ?? 0) + alpha - key) & 0xff;
		data[position] = blue;
		data[position + 1] = green;
		data[position + 2] = red;
		data[position + 3] = 0;
		position += 4;
	}
	return data;
}

/**
 * GARbro `AOpener.TryOpen`. The file starts with the 16-bit word `0xAF1E` and a 16-bit record count.
 * Each 0x20-byte record holds a 0x17-byte CP932 name, a key byte, the stored size and an offset that
 * is relative to the end of the record array. A non-zero key marks the entry as LZSS-packed behind a
 * four-byte unpacked size, and the port reads that declared size while parsing the index so listing
 * and extraction agree.
 */
async function readLeafAIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (header.readUInt16LE(0) !== SIGNATURE_VALUE) return undefined;
	const count = header.readUInt16LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	const indexEnd = BigInt(HEADER_SIZE + indexSize);
	if (indexEnd > source.size) return undefined;

	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0) return undefined;
		const key = index[record + KEY_FIELD] ?? 0;
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const offset = indexEnd + BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const compressed = key !== 0;
		if (
			compressed &&
			(storedSize < BigInt(PACKED_PREFIX_SIZE) ||
				offset + BigInt(PACKED_PREFIX_SIZE) > source.size)
		)
			return undefined;
		const unpackedSize = compressed
			? BigInt(
					(await source.readAt(offset, PACKED_PREFIX_SIZE)).readUInt32LE(0),
				)
			: storedSize;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset: compressed ? offset + BigInt(PACKED_PREFIX_SIZE) : offset,
			size: unpackedSize,
			packedSize: compressed
				? storedSize - BigInt(PACKED_PREFIX_SIZE)
				: storedSize,
			compressed,
			...(compressed ? { metadata: { key } satisfies LeafAMetadata } : {}),
		});
		// The reference decodes packed entries to the end of the LZSS stream.
		if (compressed) entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARbro `AOpener.OpenEntry`. Packed entries are decoded with a default LZSS stream; keys between
 * 0x7F and 0x89 additionally run the alpha fix-up over the declared unpacked size, which the
 * reference reads into a buffer of exactly that length. Everything else is emitted verbatim.
 */
const leafAEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Leaf A entry"),
	);
	const decoded = inflateLzssAll(stored);
	const { key } = leafAMetadata(entry);
	if (
		key < DECRYPT_KEY_MIN ||
		key > DECRYPT_KEY_MAX ||
		entry.size <= BigInt(DECRYPT_MIN_SIZE)
	)
		return Readable.from([decoded]);
	// The declared unpacked size is a 32-bit word, so it always fits a JS number.
	const length = Number(entry.size);
	const data = Buffer.alloc(length);
	decoded.copy(data, 0, 0, Math.min(decoded.length, length));
	return Readable.from([fixupAlpha(data, length, key & 0xf)]);
};

export const leafADescriptor: FormatDescriptor = {
	id: "leaf-a",
	name: "Leaf resource archive",
	extensions: ["a"],
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
			source: "ArcFormats/Leaf/ArcA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const leafAFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafADescriptor,
	detection: {
		signatures: [
			{ bytes: Buffer.from([SIGNATURE_VALUE & 0xff, SIGNATURE_VALUE >> 8]) },
		],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLeafAIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLeafAIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf A layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: leafAEntryOpener,
});
