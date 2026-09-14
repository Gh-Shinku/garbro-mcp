// Format reference: GARbro "ArcFormats/FC01/ArcBDT.cs", class `BdtOpener` (Fairytale resource archive), with
// its key tables in "ArcFormats/FC01/BdtTables.cs".
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferByteSource,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import {
	KEY_OFFSET_TABLE,
	KEY_SOURCE,
	KEY_SOURCE_SHIFT,
} from "./bdt-tables.js";
import { decodeAgsiMethod, readAgsiEntryPayload } from "./pak-agsi.js";

const SIGNATURE: Buffer = Buffer.from("PACK", "ascii");
const OGG_SIGNATURE: Buffer = Buffer.from("OggS", "ascii");
const RIFF_SIGNATURE: Buffer = Buffer.from("RIFF", "ascii");
const AVI_TAG = "AVI ";
const HEADER_SIZE = 12;
const COUNT_FIELD = 4;
const RECORD_SIZE_FIELD = 8;
const RECORD_HEADER_SIZE = 0x10;
/** The archive the others take their index from, and the number that archive is known by. */
const INDEX_ARCHIVE_NAME = "dt004.bdt";
const INDEX_ARCHIVE_NUMBER = 4;
/** Every archive of the family is named `dt0` and then a number in hexadecimal. */
const NAME_PREFIX = "dt0";
const KEY_BYTES = 8;
/** How many of a key's bytes come out of the key source unturned. */
const KEY_PLAIN_BYTES = 3;
/** The one name the reference reads its entry length from the record rather than the entry itself. */
const SPECIAL_NAME = "copyright.dat";

/** The name of a file without the directories in front of it. */
function leafName(sourcePath: string): string {
	return sourcePath.replace(/^.*[/\\]/, "");
}

/** The number an archive's own name carries, or nothing when the name is not one of these. */
function archiveNumber(sourcePath: string): number | undefined {
	// The reference counts from the name of the file without the extension on it.
	const leaf = leafName(sourcePath)
		.toLowerCase()
		.replace(/\.[^.]*$/, "");
	if (!leaf.startsWith(NAME_PREFIX)) return undefined;
	const tail = leaf.slice(NAME_PREFIX.length);
	if (!/^[0-9a-f]+$/.test(tail)) return undefined;
	return Number.parseInt(tail, 16);
}

/** The name of the file inside the index archive that holds the records of archive `number`. */
function indexEntryName(number: number): string {
	const index = number > INDEX_ARCHIVE_NUMBER ? number - 1 : number;
	return `vom${String(index).padStart(3, "0")}.dat`;
}

/**
 * GARbro `BdtOpener.GetKey`: eight bytes picked out of the reference's own key source by the table beside it,
 * the last five of them counting 480 bytes further in than the first three. The reference throws for a number
 * past the end of its table; the port declines the file there instead.
 */
function archiveKey(number: number): Uint8Array | undefined {
	const at = number * KEY_BYTES;
	if (at + KEY_BYTES > KEY_OFFSET_TABLE.length) return undefined;
	const key = new Uint8Array(KEY_BYTES);
	for (let index = 0; index < KEY_BYTES; index += 1) {
		const offset = KEY_OFFSET_TABLE[at + index] ?? 0;
		const shift = index < KEY_PLAIN_BYTES ? 0 : KEY_SOURCE_SHIFT;
		key[index] = KEY_SOURCE[offset + shift] ?? 0;
	}
	return key;
}

/**
 * GARbro `IndexReader.ReadIndex` over bytes the caller supplies, which for most archives come out of another
 * archive entirely. Every offset counts from where the records of the file they describe end, a name is as long
 * as a record has room for, and each entry has to fit inside that file. A record with no name, or one that does
 * not fit, means the whole file is not this format.
 */
function readAgsiRecords(
	index: Buffer,
	count: number,
	recordSize: number,
	dataOffset: bigint,
	fileSize: bigint,
): FixedEntry[] | undefined {
	const nameSize = recordSize - RECORD_HEADER_SIZE;
	if (nameSize <= 0) return undefined;
	if (index.length < count * recordSize) return undefined;
	const entries: FixedEntry[] = [];
	for (let position = 0; position < count; position += 1) {
		const at = position * recordSize;
		const unpackedSize = index.readUInt32LE(at);
		const size = index.readUInt32LE(at + 4);
		const method = index.readInt32LE(at + 8);
		const offset = BigInt(index.readUInt32LE(at + 0x0c)) + dataOffset;
		if (!checkPlacement(offset, BigInt(size), fileSize)) return undefined;
		const field = index.subarray(at + RECORD_HEADER_SIZE, at + recordSize);
		const end = field.indexOf(0x00);
		const name = field.subarray(0, end < 0 ? nameSize : end).toString("latin1");
		if (name.length === 0) return undefined;
		entries.push(
			createFixedEntry({
				id: position,
				path: name,
				offset,
				size: BigInt(size),
				compressed: method !== 0 && method !== 3,
				metadata: {
					method,
					unpackedSize,
					...(name.toLowerCase() === SPECIAL_NAME ? { special: true } : {}),
				} as Record<string, unknown>,
			}),
		);
	}
	return entries;
}

/** The records an archive holds itself, read from behind its own header. */
async function readOwnRecords(
	source: ByteSource,
	count: number,
	recordSize: number,
): Promise<FixedEntry[] | undefined> {
	const size = count * recordSize;
	const index = Buffer.from(await source.readAt(BigInt(HEADER_SIZE), size));
	if (index.length < size) return undefined;
	return readAgsiRecords(
		index,
		count,
		recordSize,
		BigInt(HEADER_SIZE + size),
		source.size,
	);
}

/** The count, the record size and the number of an archive, which is all its header holds. */
interface BdtHeader {
	count: number;
	recordSize: number;
	number: number;
}

function readBdtHeader(
	file: Buffer,
	sourcePath: string,
	fileSize: bigint,
): BdtHeader | undefined {
	if (file.length < HEADER_SIZE) return undefined;
	if (!file.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const number = archiveNumber(sourcePath);
	if (number === undefined) return undefined;
	const count = file.readInt32LE(COUNT_FIELD);
	// The reference wants a file with more to it than its own header.
	if (!isSaneCount(count) || fileSize <= BigInt(HEADER_SIZE)) return undefined;
	return { count, recordSize: file.readInt32LE(RECORD_SIZE_FIELD), number };
}

/**
 * GARbro `BdtOpener.ReadVomIndex`: the fourth archive holds the records of all the others, one to a file named
 * for the archive it describes, and they are read through **that** archive's own entries — which is why the
 * records of another archive are measured against the file they came from rather than the one they were read
 * from. Its own entries are unwrapped with the fourth key.
 */
async function readSharedRecords(
	sourcePath: string,
	header: BdtHeader,
	fileSize: bigint,
): Promise<FixedEntry[] | undefined> {
	const bytes = await readCompanionFile(sourcePath, INDEX_ARCHIVE_NAME);
	if (!bytes) return undefined;
	const indexHeader = readBdtHeader(
		bytes,
		INDEX_ARCHIVE_NAME,
		BigInt(bytes.length),
	);
	if (!indexHeader) return undefined;
	const indexSource = new BufferByteSource(bytes);
	const records = await readOwnRecords(
		indexSource,
		indexHeader.count,
		indexHeader.recordSize,
	);
	if (!records) return undefined;
	const entry = records.find(
		(candidate) => candidate.path === indexEntryName(header.number),
	);
	if (!entry) return undefined;
	const key = archiveKey(INDEX_ARCHIVE_NUMBER);
	const payload = await readAgsiEntryPayload(indexSource, entry, key);
	const index = decodeAgsiMethod(
		payload,
		Number(entry.metadata?.method ?? 0),
		Number(entry.metadata?.unpackedSize ?? 0),
	);
	return readAgsiRecords(
		index,
		header.count,
		header.recordSize,
		BigInt(HEADER_SIZE + header.count * header.recordSize),
		fileSize,
	);
}

/**
 * The one entry of a `.bdt` file that is not an archive at all but a piece of media the engine kept the
 * extension of: the reference hands an Ogg file, or a RIFF file tagged `AVI `, over as a single entry named
 * after the file itself. Anything else is not this format.
 */
function mediaEntries(
	file: Buffer,
	sourcePath: string,
	fileSize: bigint,
): FixedEntry[] | undefined {
	if (!leafName(sourcePath).toLowerCase().endsWith(".bdt")) return undefined;
	const signature = file.subarray(0, 4);
	let extension: string | undefined;
	let type: string | undefined;
	if (signature.equals(OGG_SIGNATURE)) {
		extension = "ogg";
		type = "audio";
	} else if (
		signature.equals(RIFF_SIGNATURE) &&
		file.subarray(8, 12).toString("latin1") === AVI_TAG
	) {
		extension = "avi";
	}
	if (extension === undefined) return undefined;
	return [
		createFixedEntry({
			id: 0,
			path: changeExtension(leafName(sourcePath), extension),
			offset: 0n,
			size: fileSize,
			...(type === undefined ? {} : { metadata: { type } }),
		}),
	];
}

interface BdtLayout {
	entries: FixedEntry[];
	/** The number the archive's name carries, which is also the index of its key; nothing for media. */
	number: number | undefined;
}

async function readBdtLayout(
	source: ByteSource,
	sourcePath: string,
): Promise<BdtLayout | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!header.subarray(0, 4).equals(SIGNATURE)) {
		const media = mediaEntries(header, sourcePath, source.size);
		return media === undefined
			? undefined
			: { entries: media, number: undefined };
	}
	const parsed = readBdtHeader(header, sourcePath, source.size);
	if (!parsed) return undefined;
	// A number past the end of the key table is one the reference throws over; nothing is read from it.
	if (archiveKey(parsed.number) === undefined) return undefined;
	const entries =
		parsed.number === INDEX_ARCHIVE_NUMBER
			? await readOwnRecords(source, parsed.count, parsed.recordSize)
			: await readSharedRecords(sourcePath, parsed, source.size);
	if (!entries) return undefined;
	return { entries, number: parsed.number };
}

export const fc01BdtDescriptor: FormatDescriptor = {
	id: "fc01-bdt",
	name: "Fairytale resource archive",
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
			source: "ArcFormats/FC01/ArcBDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fc01BdtFormat: ArchiveFormat = defineFixedArchive({
	descriptor: fc01BdtDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		// The reference registers a zero word beside its own, which asks for every file to be tried.
		extensionFallback: true,
	},
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readBdtLayout(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const layout = await readBdtLayout(source, sourcePath);
		if (!layout)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Fairytale archive");
		return {
			entries: layout.entries,
			metadata: {
				entryCount: layout.entries.length,
				...(layout.number === undefined
					? { media: true }
					: { keyIndex: layout.number }),
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry, sourcePath: string) {
		const number = archiveNumber(sourcePath);
		// The records of an archive say which of its entries are unwrapped, and every one of them is unwrapped
		// with the key its own archive's number picks out of the tables.
		const key = number === undefined ? undefined : archiveKey(number);
		const payload = await readAgsiEntryPayload(source, entry, key);
		return Readable.from([
			decodeAgsiMethod(
				payload,
				Number(entry.metadata?.method ?? 0),
				Number(entry.metadata?.unpackedSize ?? 0),
			),
		]);
	},
});
