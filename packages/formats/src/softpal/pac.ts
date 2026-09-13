// Format reference: GARBro ArcFormats/Softpal/ArcPAC.cs, classes `PacOpener` and `Pac2Opener`.
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
} from "../shared/fixed-archive.js";

/** The Amuse variant announces itself; the Softpal one only relies on its extension. */
const AMUSE_SIGNATURE = Buffer.from("PAC ", "ascii");
const EXTENSION = "pac";
const SOFTPAL_COUNT_OFFSET = 0;
const SOFTPAL_INDEX_OFFSET = 0x3fe;
const AMUSE_COUNT_OFFSET = 8;
const AMUSE_INDEX_OFFSET = 0x804;
/** The Softpal variant tries a wide name field and then a narrow one; Amuse uses the wide one only. */
const SOFTPAL_NAME_LENGTHS = [0x20, 0x10] as const;
const AMUSE_NAME_LENGTH = 0x20;
const NAME_SIZE = 0x20;
const WORD_SIZE = 4;
/** A record is the name field, the stored size and the data offset. */
const RECORD_TAIL = WORD_SIZE * 2;
/** Payload obfuscation covers everything behind a sixteen-byte prefix and starts with a `$`. */
const MARKER = 0x24;
const PREFIX_SIZE = 16;
const BASE_SHIFT = 4;
const SHIFT_MASK = 7;
const OBFUSCATION_XOR = 0xf7d5859d;
/** GARbro skips the transform for entries its catalog classifies as images or audio. */
const SKIPPED_EXTENSIONS = new Set([
	"abm",
	"bmp",
	"gif",
	"jpeg",
	"jpg",
	"ogg",
	"png",
	"tga",
	"tif",
	"tiff",
	"wav",
]);

export const softpalPacDescriptor: FormatDescriptor = {
	id: "softpal-pac",
	name: "Archive format used by Softpal subsidiaries",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Softpal/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const amusePacDescriptor: FormatDescriptor = {
	id: "softpal-amuse-pac",
	name: "Archive format used by Amuse Craft subsidiaries",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: softpalPacDescriptor.attribution,
};

/** Rotates a byte left, masking the count the way the reference's helper does. */
function rotateByteLeft(value: number, count: number): number {
	const shift = count & SHIFT_MASK;
	return (((value << shift) | (value >>> (8 - shift))) & 0xff) >>> 0;
}

/**
 * GARBro `PacOpener.OpenEntry`'s payload transform. Every full 32-bit word behind a sixteen-byte prefix has
 * its first byte — the low byte in little-endian order — rotated left by a shift that starts at four and
 * grows by one per word, and is then exclusive-ored with a fixed constant. The first sixteen bytes are left
 * alone, and the reference only applies any of this when the payload starts with `$` and its entry is not
 * classified as an image or an audio file.
 */
function transformPayload(data: Buffer): Buffer {
	const output = Buffer.from(data);
	const words = Math.trunc((output.length - PREFIX_SIZE) / WORD_SIZE);
	for (let index = 0; index < words; index += 1) {
		const position = PREFIX_SIZE + index * WORD_SIZE;
		const word = output.readUInt32LE(position);
		const rotated = rotateByteLeft(word & 0xff, BASE_SHIFT + index);
		output.writeUInt32LE(
			(((word & 0xffffff00) | rotated) ^ OBFUSCATION_XOR) >>> 0,
			position,
		);
	}
	return output;
}

/**
 * GARBro `PacOpener.ReadIndex`, shared by both variants. A record is a fixed-width name field, the stored
 * size, and the data offset, and the layout is pinned down by the first record's offset word, which must
 * equal the end of the index.
 */
function readRecords(
	index: Buffer,
	count: number,
	nameLength: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const stride = nameLength + RECORD_TAIL;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * stride;
		if (record + stride > index.length) return undefined;
		const field = index.subarray(record, record + nameLength);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.trim().length === 0) return undefined;
		const size = BigInt(index.readUInt32LE(record + nameLength));
		const offset = BigInt(index.readUInt32LE(record + nameLength + WORD_SIZE));
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		const skipped = SKIPPED_EXTENSIONS.has(sourceExtension(name));
		const obfuscated = !skipped && size > BigInt(PREFIX_SIZE);
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: obfuscated,
				metadata: { obfuscated },
			}),
		);
	}
	return entries;
}

/**
 * GARBro `PacOpener.TryOpen`. The entry count sits at 0 and the index at 0x3FE, and a candidate name field
 * width is only accepted when the first record's offset word equals the end of the index, which the port
 * reproduces, trying the wide field before the narrow one. The format carries no signature, so the `pac`
 * extension and that alignment check together are the detection.
 */
async function readSoftpalIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	// The narrowest candidate decides the smallest file the Softpal variant can live in.
	const minimumSize =
		SOFTPAL_INDEX_OFFSET + (SOFTPAL_NAME_LENGTHS[1] ?? NAME_SIZE) + RECORD_TAIL;
	if (source.size < BigInt(minimumSize)) return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(SOFTPAL_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	for (const nameLength of SOFTPAL_NAME_LENGTHS) {
		const stride = nameLength + RECORD_TAIL;
		const indexEnd = BigInt(SOFTPAL_INDEX_OFFSET + count * stride);
		if (indexEnd > source.size) continue;
		const probe = await source.readAt(
			BigInt(SOFTPAL_INDEX_OFFSET + nameLength + WORD_SIZE),
			WORD_SIZE,
		);
		if (BigInt(probe.readUInt32LE(0)) !== indexEnd) continue;
		if (indexEnd >= source.size) continue;
		const index = await source.readAt(
			BigInt(SOFTPAL_INDEX_OFFSET),
			count * stride,
		);
		const entries = readRecords(index, count, nameLength, source.size);
		if (entries) return entries;
	}
	return undefined;
}

/**
 * GARBro `Pac2Opener.TryOpen`. This variant announces itself with `PAC `, keeps its count at 8, and starts
 * its index at 0x804 with the wide name field only. It performs the same alignment check as its sibling but
 * without the check that the index ends inside the file, and the port keeps that difference.
 */
async function readAmuseIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	const headerSize = AMUSE_INDEX_OFFSET + AMUSE_NAME_LENGTH + RECORD_TAIL;
	if (source.size < BigInt(headerSize)) return undefined;
	const header = await source.readAt(0n, AMUSE_COUNT_OFFSET + 4);
	if (!header.subarray(0, AMUSE_SIGNATURE.length).equals(AMUSE_SIGNATURE))
		return undefined;
	const count = header.readInt32LE(AMUSE_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexEnd = BigInt(
		AMUSE_INDEX_OFFSET + count * (AMUSE_NAME_LENGTH + RECORD_TAIL),
	);
	if (indexEnd > source.size) return undefined;
	const probe = await source.readAt(
		BigInt(AMUSE_INDEX_OFFSET + AMUSE_NAME_LENGTH + WORD_SIZE),
		WORD_SIZE,
	);
	if (BigInt(probe.readUInt32LE(0)) !== indexEnd) return undefined;
	const index = await source.readAt(
		BigInt(AMUSE_INDEX_OFFSET),
		count * (AMUSE_NAME_LENGTH + RECORD_TAIL),
	);
	return readRecords(index, count, AMUSE_NAME_LENGTH, source.size);
}

/** GARBro `PacOpener.OpenEntry`: the transform only applies to marked, unclassified payloads. */
async function openSoftpalEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.size));
	if (entry.metadata?.obfuscated !== true) return Readable.from([stored]);
	if (stored.length <= PREFIX_SIZE || stored[0] !== MARKER)
		return Readable.from([stored]);
	return Readable.from([transformPayload(stored)]);
}

export const softpalPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: softpalPacDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readSoftpalIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readSoftpalIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Softpal PAC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openSoftpalEntry,
});

export const amusePacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: amusePacDescriptor,
	detection: { signatures: [{ bytes: AMUSE_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAmuseIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAmuseIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Amuse PAC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openSoftpalEntry,
});
