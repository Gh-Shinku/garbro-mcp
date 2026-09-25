// Format reference: GARbro "ArcFormats/Actgs/ArcDAT.cs", class `DatOpener` with its `IndexReader`. The
// reference's own key table ships **empty** - `DefaultScheme = new ActressScheme { KnownKeys =
// Array.Empty<byte[]>() }` - so an archive whose index does not stand where its head says it should cannot be
// told apart at all: that way is refused here by name rather than guessed at. GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The head names how many entries stand behind it, and holds three words that have to be nothing. */
const HEADER_SIZE = 0x10;
const COUNT_FIELD = 0;
const ZERO_FIELDS = [4, 8, 0xc];
/** One entry of the index: where it stands, how long it is, and its name. */
const INDEX_ENTRY_SIZE = 0x20;
const INDEX_OFFSET_FIELD = 0;
const INDEX_SIZE_FIELD = 4;
const INDEX_NAME_FIELD = 8;
const NAME_LENGTH = 0x18;
/** The name an archive of this engine carries. */
const ARCHIVE_EXTENSIONS = ["dat"];
/** The reference reads its index through a stream of its own, so this is the most it will look at. */
const MAX_INDEX_BYTES = 0x10 + 0x40000 * INDEX_ENTRY_SIZE;

export interface ActressEntry {
	offset: number;
	size: number;
	name: string;
}

export interface ActressIndex {
	entries: ActressEntry[];
	/** Where the index says the data begins, and where the first entry actually stands. */
	firstOffset: number;
	actualOffset: number;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function notReadable(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

/**
 * `DatOpener.TryOpen`'s head check and `IndexReader.Read`: the count has to be sane, the three words behind
 * it nothing, and every entry has to stand inside the archive. The index is read from the stream the
 * reference makes of it, so this port reads no further than the place that stream ends at.
 */
export function readActressIndex(
	data: Buffer,
	maxOffset: bigint,
): ActressIndex | undefined {
	if (data.length < HEADER_SIZE) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	for (const at of ZERO_FIELDS) {
		if (0 !== data.readUInt32LE(at)) return undefined;
	}
	const indexEnd = HEADER_SIZE + count * INDEX_ENTRY_SIZE;
	if (indexEnd > data.length) return undefined;
	const entries: ActressEntry[] = [];
	let actualOffset = 0;
	for (let number = 0; number < count; number += 1) {
		const at = HEADER_SIZE + number * INDEX_ENTRY_SIZE;
		const offset = data.readUInt32LE(at + INDEX_OFFSET_FIELD);
		const size = data.readUInt32LE(at + INDEX_SIZE_FIELD);
		if (!checkPlacement(BigInt(offset), BigInt(size), maxOffset)) {
			return undefined;
		}
		if (0 === number) actualOffset = offset;
		entries.push({
			offset,
			size,
			name: decodeCStringField(data, at + INDEX_NAME_FIELD, NAME_LENGTH),
		});
	}
	return { entries, firstOffset: indexEnd, actualOffset };
}

/** How much of an archive this port reads to tell its head and its index apart. */
function indexBytes(size: number): number {
	return Math.min(size, MAX_INDEX_BYTES);
}

async function readIndex(
	source: ByteSource,
): Promise<ActressIndex | undefined> {
	const size = Number(source.size);
	if (size < HEADER_SIZE) return undefined;
	return readActressIndex(
		Buffer.from(await source.readAt(0n, indexBytes(size))),
		source.size,
	);
}

/** Whether the index stands where the head says it should, which is what a readable archive needs. */
function isPlain(index: ActressIndex): boolean {
	return index.actualOffset === index.firstOffset;
}

export const actressDatDescriptor: FormatDescriptor = {
	id: "actgs-dat-archive",
	name: "ACTGS engine resource archive",
	extensions: ARCHIVE_EXTENSIONS,
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
			source: "ArcFormats/Actgs/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const actressDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: actressDatDescriptor,
	// The archive writes no word of its own: the reference tells it by its name and by the shape of its head.
	detection: { signatures: [], priority: -1, extensionFallback: true },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		if (!sourcePath) return false;
		if (!ARCHIVE_EXTENSIONS.includes(sourceExtension(sourcePath))) return false;
		const index = await readIndex(source);
		return index !== undefined && isPlain(index);
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readIndex(source);
		if (!index) throw invalid("Not an ACTGS engine resource archive");
		if (!isPlain(index)) {
			throw notReadable(
				"The archive's index does not stand where its head says it should, which means it is keyed: the reference's own key table ships empty",
			);
		}
		if (0 === index.entries.length) {
			throw invalid("The archive's index names no entry");
		}
		const entries: FixedEntry[] = index.entries.map((item, number) =>
			createFixedEntry({
				id: number,
				...normalizeEntryPath(item.name),
				offset: BigInt(item.offset),
				size: BigInt(item.size),
			}),
		);
		return {
			entries,
			metadata: { extension: sourceExtension(sourcePath) },
		};
	},
	async openEntry(source: ByteSource, entry) {
		// An entry of a plain archive of this engine stands in it as it is: the reference hands it over
		// untouched, since every way it knows to unwrap one stands behind a key.
		return Readable.from([
			Buffer.from(
				await source.readAt(BigInt(entry.offset), Number(entry.size)),
			),
		]);
	},
});
