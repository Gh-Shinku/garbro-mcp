// Format reference: GARBro ArcFormats/Misc/ArcBIN.cs, class `BinOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const FIRST_OFFSET = 4;
const INDEX_START = 4;
const INDEX_RECORD_SIZE = 8;
const NAME_WIDTH = 5;
/** A message archive keeps its lengths inside the payloads instead of the index. */
const MESSAGE_BASE_NAME = "msg";
/** The two high bits of the unpacked size distinguish a packed payload. */
const FLAG_SHIFT = 30;
const SIZE_MASK = 0x3fffffff;
/** Packed payloads may carry a one-byte prefix followed by the file signature. */
const SIGNATURE_NIBBLE = 0xf;
const SIGNATURE_OFFSET = 1;

/** GARbro `AutoEntry.DetectFileType`, limited to the two special cases. */
const DETECTED_TYPES: readonly {
	signature: number;
	type: string;
	extension: string;
}[] = [
	{ signature: 0x5367674f, type: "audio", extension: "ogg" },
	{ signature: 0x46464952, type: "audio", extension: "wav" },
];
const BMP_SIGNATURE = 0x4d42;

interface DetectedType {
	type: string;
	extension: string;
}

/**
 * GARbro `AutoEntry.DetectFileType`, restricted to the Ogg, RIFF and bitmap special cases; the
 * catalog-wide signature lookup is not reproduced, so an unknown signature leaves the entry alone.
 */
function detectFileType(signature: number): DetectedType | undefined {
	if (signature === 0) return undefined;
	const match = DETECTED_TYPES.find(
		(candidate) => candidate.signature === signature,
	);
	if (match) return { type: match.type, extension: match.extension };
	if ((signature & 0xffff) === BMP_SIGNATURE)
		return { type: "image", extension: "bmp" };
	return undefined;
}

interface BinHeader {
	entries: FixedEntry[];
}

/**
 * GARbro `BinOpener.TryOpen`. The archive opens with an entry count and the offset of the first
 * payload, which has to be exactly where an index of eight-byte records ends. Entry names are
 * `<archive>#<index>` with a five-digit index and no extension.
 *
 * The index records are only placement-checked here. A second pass then resolves every entry, and how
 * it does so depends on the archive's base name:
 *
 * - A `msg` archive keeps the unpacked size in the index and the stored size in the first payload
 *   word, and every entry is LZSS compressed.
 * - Any other archive stores a position word at payload offset four. When that position exceeds the
 *   index size the entry is left as the raw index range. Otherwise the word at payload offset eight
 *   holds the unpacked size in its low 30 bits; a zero flag means the entry is LZSS compressed and the
 *   stored size sits at the position word, while a non-zero flag means the entry is stored and its
 *   size is the unpacked size itself.
 *
 * The file signature used for typing is read from behind the payload position — behind one extra byte
 * when that byte's low nibble is 0x0F.
 */
async function readBinIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<BinHeader | undefined> {
	if (!sourcePath) return undefined;
	if (source.size < BigInt(FIRST_OFFSET)) return undefined;
	const header = await source.readAt(0n, FIRST_OFFSET + 4);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const firstOffset = header.readUInt32LE(FIRST_OFFSET);
	if (BigInt(INDEX_START + count * INDEX_RECORD_SIZE) !== BigInt(firstOffset))
		return undefined;
	if (BigInt(firstOffset) > source.size) return undefined;

	const baseName = basename(sourcePath).replace(/\.[^.]*$/, "");
	const isMessage = baseName === MESSAGE_BASE_NAME;
	const index = await source.readAt(
		BigInt(INDEX_START),
		count * INDEX_RECORD_SIZE,
	);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * INDEX_RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const size = BigInt(index.readUInt32LE(record + 4));
		if (!isMessage && !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(
					`${baseName}#${String(id).padStart(NAME_WIDTH, "0")}`,
				),
				offset,
				size,
			}),
		);
	}
	if (isMessage) {
		for (const entry of entries) await resolveMessageEntry(source, entry);
	} else {
		for (const entry of entries) await resolveStoredEntry(source, entry);
	}
	return { entries };
}

/** The `msg` layout: the index holds the unpacked size and the payload its stored size. */
async function resolveMessageEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<void> {
	const storedSize = BigInt(
		(await source.readAt(entry.offset, 4)).readUInt32LE(0),
	);
	const payloadOffset = entry.offset + 4n;
	if (!checkPlacement(payloadOffset, storedSize, source.size))
		throw new GarbroError("INVALID_ARCHIVE", "Invalid BIN entry placement");
	// The index already holds the unpacked size; the payload word is the stored length.
	entry.offset = payloadOffset;
	entry.packedSize = storedSize;
	entry.compressed = true;
	entry.sizeKnown = false;
}

/** The generic layout: a position word, a flagged unpacked size and an optional prefix byte. */
async function resolveStoredEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<void> {
	const indexSize = entry.size;
	const position = BigInt(
		(await source.readAt(entry.offset + 4n, 4)).readUInt32LE(0),
	);
	// A position behind the entry leaves it as the raw index range.
	if (position > indexSize) return;
	const flagged = (await source.readAt(entry.offset + 8n, 4)).readUInt32LE(0);
	const unpackedSize = BigInt(flagged & SIZE_MASK);
	const compressed = flagged >>> FLAG_SHIFT === 0;
	let payloadOffset: bigint;
	let storedSize: bigint;
	let signatureOffset: bigint | undefined;
	if (compressed) {
		payloadOffset = entry.offset + position;
		storedSize = BigInt(
			(await source.readAt(payloadOffset, 4)).readUInt32LE(0),
		);
		payloadOffset += 4n;
		const prefix = (await source.readAt(payloadOffset, 1))[0] ?? 0;
		if ((prefix & SIGNATURE_NIBBLE) === SIGNATURE_NIBBLE)
			signatureOffset = payloadOffset + BigInt(SIGNATURE_OFFSET);
	} else {
		payloadOffset = entry.offset + position;
		storedSize = unpackedSize;
		signatureOffset = payloadOffset;
	}
	if (signatureOffset !== undefined) {
		if (signatureOffset + 4n > source.size)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated BIN payload");
		const signature = (await source.readAt(signatureOffset, 4)).readUInt32LE(0);
		const detected = detectFileType(signature);
		if (detected) {
			entry.path = changeExtension(entry.path, detected.extension);
			entry.metadata = { type: detected.type };
		}
	}
	entry.offset = payloadOffset;
	entry.size = unpackedSize;
	entry.packedSize = storedSize;
	entry.compressed = compressed;
	// Only a stored payload is exactly as long as it declares.
	entry.sizeKnown = !compressed;
}

/** GARbro `BinOpener.OpenEntry`: compressed payloads are LZSS, everything else is stored. */
const binEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([inflateLzssAll(stored)]);
};

export const miscBinDescriptor: FormatDescriptor = {
	id: "misc-bin",
	name: "Uncategorized resource archive",
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
			source: "ArcFormats/Misc/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const miscBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: miscBinDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readBinIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const result = await readBinIndex(source, sourcePath).catch(
			() => undefined,
		);
		if (!result) throw new GarbroError("INVALID_ARCHIVE", "Invalid BIN layout");
		return {
			entries: result.entries,
			metadata: { entryCount: result.entries.length },
		};
	},
	openEntry: binEntryOpener,
});
