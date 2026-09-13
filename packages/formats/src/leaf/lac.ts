// Format reference: GARBro ArcFormats/Leaf/ArcLAC.cs, classes `LacOpener` (LAC) and `PakOpener`
// (PAK/LAC).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
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

/** The registered signature is the 32-bit value `0x0043414C`. */
const SIGNATURE = Buffer.from("LAC\0", "ascii");
const COUNT_OFFSET = 4;
const INDEX_START = 8;

/** `LacOpener` records: 0x3E bytes of name, a flag byte, then sizes and a 64-bit offset. */
const LAC_NAME_SIZE = 0x3e;
const LAC_FLAG_OFFSET = 0x3e;
const LAC_SIZE_OFFSET = 0x54;
const LAC_UNPACKED_OFFSET = 0x58;
const LAC_OFFSET_OFFSET = 0x60;
const LAC_STRIDE = 0x78;
/** `LacOpener` unpacks with a ring buffer pre-filled with spaces. */
const LAC_FRAME_FILL = 0x20;

/** `PakOpener` records: a masked 0x1F-byte name, a flag byte, then size and offset. */
const PAK_NAME_SIZE = 0x20;
const PAK_NAME_MASK = 0x1f;
const PAK_FLAG_OFFSET = 0x1f;
const PAK_STRIDE = 0x28;

/**
 * GARbro `LacOpener.TryOpen`. Records carry the stored and unpacked sizes outright, so listing needs no
 * payload access; compressed entries run through LZSS with a space-filled frame.
 */
async function readLacIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = BigInt(INDEX_START + id * LAC_STRIDE);
		if (base + BigInt(LAC_STRIDE) > source.size) return undefined;
		const record = await source.readAt(base, LAC_STRIDE);
		const name = decodeCStringField(record, 0, LAC_NAME_SIZE);
		if (name.length === 0) return undefined;
		const size = BigInt(record.readUInt32LE(LAC_SIZE_OFFSET));
		const unpackedSize = BigInt(record.readUInt32LE(LAC_UNPACKED_OFFSET));
		const offset = record.readBigInt64LE(LAC_OFFSET_OFFSET);
		const compressed = record[LAC_FLAG_OFFSET] !== 0;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				// A stored entry yields its stored range; a compressed one is decoded to the declared size.
				size: compressed ? unpackedSize : size,
				packedSize: size,
				compressed,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARbro `PakOpener.TryOpen` masks the name field with 0xFF — the stored terminator is 0xFF, and the
 * padding behind the name is zero, which is what stops the loop. The byte past the name field is the
 * compression flag and is never masked.
 *
 * The reference leaves whatever the mask produced in the name, which for a space-padded field ends in
 * null characters. Those are dropped here so the resulting path stays usable.
 */
async function readPakName(
	source: ByteSource,
	offset: bigint,
): Promise<{ name: string; field: Buffer } | undefined> {
	if (offset >= source.size) return undefined;
	const available = Number(
		source.size - offset < BigInt(PAK_NAME_SIZE)
			? source.size - offset
			: BigInt(PAK_NAME_SIZE),
	);
	const field = Buffer.from(await source.readAt(offset, available));
	let length = 0;
	while (length < PAK_NAME_MASK && field[length] !== 0) {
		field[length] = (field[length] ?? 0) ^ 0xff;
		length += 1;
	}
	if (length === 0) return undefined;
	const decoded = decodeCp932(field.subarray(0, length));
	const name = decoded.replace(/\0+$/u, "");
	if (name.length === 0) return undefined;
	return { name, field };
}

/**
 * GARbro `PakOpener.OpenEntry` strips a header from compressed payloads before unpacking: the first
 * word is the unpacked size, unless it happens to equal the entry size, in which case another word is
 * skipped first. A zero unpacked size becomes one. Resolving it while listing keeps the declared entry
 * size and the extraction in step.
 */
async function resolvePakPayload(
	source: ByteSource,
	offset: bigint,
	size: bigint,
	entryId: number,
	name: string,
	compressed: boolean,
): Promise<FixedEntry | undefined> {
	let payloadOffset = offset;
	let storedSize = size;
	if (!compressed || size <= 4n) {
		if (!checkPlacement(payloadOffset, storedSize, source.size))
			return undefined;
		return createFixedEntry({
			id: entryId,
			...normalizeEntryPath(name),
			offset: payloadOffset,
			size: storedSize,
		});
	}
	const first = await source.readAt(payloadOffset, 4);
	if (BigInt(first.readUInt32LE(0)) === size) {
		payloadOffset += 4n;
		storedSize -= 4n;
	}
	const unpackedWord = await source.readAt(payloadOffset, 4);
	payloadOffset += 4n;
	storedSize -= 4n;
	if (storedSize < 0n) {
		// The reference wraps the unsigned subtraction; a payload this short cannot be unpacked anyway.
		return undefined;
	}
	let unpackedSize = BigInt(unpackedWord.readUInt32LE(0));
	if (unpackedSize === 0n) unpackedSize = 1n;
	if (!checkPlacement(payloadOffset, storedSize, source.size)) return undefined;
	return createFixedEntry({
		id: entryId,
		...normalizeEntryPath(name),
		offset: payloadOffset,
		size: unpackedSize,
		packedSize: storedSize,
		compressed: true,
	});
}

/** GARbro `PakOpener.TryOpen`: masked names, a flag byte and size/offset pairs from 0x08. */
async function readPakIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const base = BigInt(INDEX_START + id * PAK_STRIDE);
		if (base + BigInt(PAK_STRIDE) > source.size) return undefined;
		const parsed = await readPakName(source, base);
		if (!parsed) return undefined;
		const tail = await source.readAt(base + BigInt(PAK_NAME_SIZE), 8);
		const size = BigInt(tail.readUInt32LE(0));
		const offset = BigInt(tail.readUInt32LE(4));
		const compressed = parsed.field[PAK_FLAG_OFFSET] !== 0;
		const entry = await resolvePakPayload(
			source,
			offset,
			size,
			id,
			parsed.name,
			compressed,
		);
		if (!entry) return undefined;
		entries.push(entry);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARbro `LacOpener.OpenEntry`: stored ranges pass through, compressed ones run through LZSS. */
const lacEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const output = Buffer.alloc(Number(entry.size));
	inflateLzssAll(stored, {
		frameFill: LAC_FRAME_FILL,
		maxOutputLength: output.length,
	}).copy(output);
	return Readable.from([output]);
};

/** GARbro `PakOpener.OpenEntry`: the default LZSS frame fill. */
const pakEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const output = Buffer.alloc(Number(entry.size));
	inflateLzssAll(stored, { maxOutputLength: output.length }).copy(output);
	return Readable.from([output]);
};

const attribution = {
	project: "GARbro",
	source: "ArcFormats/Leaf/ArcLAC.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

export const leafLacDescriptor: FormatDescriptor = {
	id: "leaf-lac",
	name: "Leaf resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const leafLacPakDescriptor: FormatDescriptor = {
	id: "leaf-lac-pak",
	name: "Leaf resource archive",
	extensions: ["pak"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const leafLacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafLacDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readLacIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readLacIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LAC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: lacEntryOpener,
});

export const leafLacPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafLacPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPakIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPakIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pakEntryOpener,
});
