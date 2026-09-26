// Port of GARbro "ArcFormats/elf/ArcAi5Win.cs" (tag "ARC/AI5WIN", class ArcAI5Opener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. An archive of the AI5WIN engine: the length of a
// name, the cipher of the names and the ciphers of the sizes and of the places of the pictures stand of no
// place of the file, and the reference works them out of the index itself where it holds no scheme for the
// game at hand.
//
// The reference tries the schemes of its own table first (`KnownSchemes`, which a stock build leaves empty:
// it is filled from the settings of the user and from the format database of the engine) and then falls back
// on `GuessSchemes`, which reads a shape out of the index. This port carries no scheme table and stands of
// the guess alone, which is the walk a stock build of the reference stands of as well.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { extname } from "node:path";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	type FixedEntry,
	type FixedEntryOpener,
	isSaneCount,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";
/** `Ai5ArcIndexReader.NameLengths`: the counts of the places of a name a scheme of the engine may name. */
export const AI5_NAME_LENGTHS = [0x14, 0x1e, 0x20, 0x100] as const;
/** Where the index of the archive begins: the count of the pictures of it stands in front of it. */
const INDEX_OFFSET = 4;
/** The places of the file one record of the index stands of, of a name of the scheme's own count. */
const RECORD_OVERHEAD = 8;
/**
 * `ArcAI5Opener.OpenEntry`: the places of a picture of the engine stand of the LZSS walk of the engine for
 * the names of these places.
 */
const LZSS_EXTENSIONS = new Set(["mes", "lib", "a", "a6", "msk", "x"]);
/** The least place of a name of the engine; a name of a place below it is refused. */
const LEAST_NAME_BYTE = 0x20;

/** The shape of the index of an archive of the engine: the count of a name and three ciphers. */
export interface Ai5Scheme {
	nameLength: number;
	nameKey: number;
	sizeKey: number;
	offsetKey: number;
}

/** A picture of the engine: the name of it, and where its places stand and of what count. */
export interface Ai5Entry {
	name: string;
	offset: number;
	size: number;
}

/**
 * `Ai5ArcIndexReader.GuessSchemes`: a shape of the index read out of the index itself. The count of the
 * places of the places of the pictures of the engine stands of the count of the pictures and of the count of
 * a name alone, so the cipher of a place follows from the first picture of the file, and the cipher of a
 * count from the place of the second picture, which the first cipher names.
 */
export function guessAi5Schemes(data: Buffer, count: number): Ai5Scheme[] {
	const found: Ai5Scheme[] = [];
	if (count < 2) return found;
	const fileSize = data.length;
	for (const nameLength of AI5_NAME_LENGTHS) {
		const dataOffset = (nameLength + RECORD_OVERHEAD) * count + INDEX_OFFSET;
		if (dataOffset + RECORD_OVERHEAD > fileSize) continue;
		// The walk reads the places of the second picture of the file as well.
		if ((nameLength + RECORD_OVERHEAD) * 2 + 4 > fileSize) continue;
		const nameKey = data[3 + nameLength] ?? 0;
		const firstSize = data.readUInt32LE(4 + nameLength);
		const firstOffset = data.readUInt32LE(8 + nameLength);
		const offsetKey = (dataOffset ^ firstOffset) >>> 0;
		const secondOffset =
			(data.readUInt32LE((nameLength + RECORD_OVERHEAD) * 2) ^ offsetKey) >>> 0;
		if (secondOffset < dataOffset || secondOffset >= fileSize) continue;
		const sizeKey = (((secondOffset - dataOffset) ^ firstSize) >>> 0) >>> 0;
		if (0 === offsetKey || 0 === sizeKey) continue;
		found.push({ nameLength, nameKey, sizeKey, offsetKey });
	}
	return found;
}

/** `Ai5ArcIndexReader.DecryptName`: the name of a picture of the engine, of the cipher of the names. */
function readAi5Name(record: Buffer, scheme: Ai5Scheme): string | undefined {
	const bytes = Buffer.from(record.subarray(0, scheme.nameLength));
	for (let at = 0; at < bytes.length; at += 1) {
		bytes[at] = (bytes[at] ?? 0) ^ scheme.nameKey;
		if (0 === bytes[at]) {
			if (0 === at) return undefined;
			return decodeCp932(bytes.subarray(0, at));
		}
		if ((bytes[at] ?? 0) < LEAST_NAME_BYTE) return undefined;
	}
	// The reference reads one place of the file beyond the count of a name of the scheme, so a name whose
	// word of no name stands outside that count may be read there; this port stands of the count itself.
	return undefined;
}

/** `Ai5ArcIndexReader.Read`: the pictures of the engine, of the shape of the index given. */
export function readAi5Index(
	data: Buffer,
	count: number,
	scheme: Ai5Scheme,
): Ai5Entry[] | undefined {
	if (scheme.nameLength <= 0) return undefined;
	const recordSize = scheme.nameLength + RECORD_OVERHEAD;
	const indexSize = count * recordSize;
	if (indexSize + INDEX_OFFSET > data.length) return undefined;
	const entries: Ai5Entry[] = [];
	for (let at = 0; at < count; at += 1) {
		const start = INDEX_OFFSET + at * recordSize;
		const name = readAi5Name(
			data.subarray(start, start + scheme.nameLength),
			scheme,
		);
		if (undefined === name) return undefined;
		const places = start + scheme.nameLength;
		const size = (data.readUInt32LE(places) ^ scheme.sizeKey) >>> 0;
		const offset = (data.readUInt32LE(places + 4) ^ scheme.offsetKey) >>> 0;
		if (offset < indexSize + INDEX_OFFSET) return undefined;
		if (!checkPlacement(BigInt(offset), BigInt(size), BigInt(data.length))) {
			return undefined;
		}
		entries.push({ name, offset, size });
	}
	return entries;
}

/** The first shape of the index that reads the whole of the pictures of the engine. */
export function readAi5Directory(data: Buffer): Ai5Entry[] | undefined {
	if (data.length < INDEX_OFFSET + RECORD_OVERHEAD) return undefined;
	const count = data.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	for (const scheme of guessAi5Schemes(data, count)) {
		const entries = readAi5Index(data, count, scheme);
		if (entries) return entries;
	}
	return undefined;
}

export const ai5WinDescriptor: FormatDescriptor = {
	id: "elf-ai5win",
	name: "AI5WIN engine resource archive",
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
			source: "ArcFormats/elf/ArcAi5Win.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

export const ai5WinEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	const extension = extname(entry.path).replace(/^\./, "").toLowerCase();
	if (!LZSS_EXTENSIONS.has(extension)) return Readable.from([data]);
	return Readable.from([inflateLzssAll(data)]);
};

export const ai5WinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ai5WinDescriptor,
	detection: { signatures: [], priority: -1 },
	async detect(source: ByteSource): Promise<boolean> {
		try {
			const data = Buffer.from(await source.readAt(0n, Number(source.size)));
			return readAi5Directory(data) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, _sourcePath: string) {
		const data = Buffer.from(await source.readAt(0n, Number(source.size)));
		const entries = readAi5Directory(data);
		if (!entries) throw invalidArchive("Not an archive of the AI5WIN engine");
		const names = new Set<string>();
		const fixed: FixedEntry[] = [];
		for (const entry of entries) {
			if (names.has(entry.name)) {
				throw invalidArchive("The archive stands of two pictures of one name");
			}
			names.add(entry.name);
			fixed.push({
				...createFixedEntry({
					id: fixed.length,
					path: entry.name,
					offset: BigInt(entry.offset),
					size: BigInt(entry.size),
					compressed: LZSS_EXTENSIONS.has(
						extname(entry.name).replace(/^\./, "").toLowerCase(),
					),
					metadata: { type: "file" } as Record<string, unknown>,
				}),
				sizeKnown: true,
			});
		}
		return {
			entries: fixed,
			metadata: { count: fixed.length, scheme: "read-out-of-the-index" },
		};
	},
	openEntry: ai5WinEntryOpener,
});

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}
