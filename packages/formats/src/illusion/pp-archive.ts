// Port of GARbro "ArcFormats/Illusion/ArcPP.cs" (tag "PP/ILLUSION", class PpOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The resource archives of the engine of Illusion.
//
// The head of an archive of the engine stands of the word `[PPVER]`, and the nine places behind it - the
// count of the version of the engine, the count of the walk of the places of the entry and the count of the
// entries - stand of a cipher of the engine's own, whose two keys stand in the reference's source. The
// index behind them stands of the same cipher, and every place of it stands of the name of a file of the
// engine, of the counts of the places of it and of the count of its places in the file.
//
// The places of the *entries* stand of a scheme the reference looks up by the name of the game
// (`QueryEncryptionScheme`, of `KnownKeys`), which stands **empty** in the shipped reference: with no
// scheme the reference refuses the whole archive, whatever the walk of the places of an entry may be. What
// the walk of the entries stands of is written down here rather than carried as code:
//
//   * `Method` 0, 1 and 2 of a scheme stand of the places of its key, of one, two and four places of the
//     file at a time, cycled over the key (`DecryptData1`),
//   * `Method` 3 stands of two keys of four words, of the first one standing of the second one after every
//     place of the file, over two places of the file at a time (`DecryptData3`),
//   * the fourth walk of an archive (`UnpackData`) is a stub in the reference: it hands the places of the
//     file back as they stand.
//
// The port therefore reads the whole walk of the *index* of an archive of the engine - which stands of no
// scheme at all - lists the files of it, and answers for the places of a file of the walk the archive itself
// names in the count of the places of its entry: no walk of a scheme at all where the count stands at 0, 2
// or 4 (the reference hands such a file over as it stands, of its own stub at the fourth count), and a
// refusal, named as such, where it stands at 1 or 3 and a scheme of the game would be asked for. That is a
// departure from the reference, which refuses the whole archive where it holds no scheme for the game; it is
// written down in `docs/formats/illusion-pp-archive.md`.

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
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `PpOpener`: the word of the head of an archive of the engine. */
const SIGNATURE = Buffer.from("[PPVER]\0", "latin1");
/** The nine places behind the head: the version, the count of the walk of the entries and their count. */
const HEAD_OFFSET = 8;
const HEAD_PLACES = 9;
const VERSION_OFFSET = 0;
const VERSION_PLACES = 4;
const METHOD_OFFSET = 4;
const METHOD_PLACES = 1;
const COUNT_OFFSET = 5;
const COUNT_PLACES = 4;
/** `TryOpen`: the count of the version of the engine stands at or behind this count. */
const LEAST_VERSION = 0x6c;
/** The places of the index: from the head, of the name and of the counts of every entry of it. */
const INDEX_OFFSET = 0x11;
const NAME_PLACES = 0x104;
const RECORD_PLACES = 0x120;
const SIZE_OFFSET = NAME_PLACES;
const OFFSET_OFFSET = NAME_PLACES + 4;
/** The counts of the places of an entry the reference knows a walk of the scheme of the game for. */
const SCHEME_METHODS = [1, 3];

/** `PpOpener.DefaultIndexKey`: the two keys of the cipher of the places of the index of the engine. */
export const PP_INDEX_KEYS: readonly (readonly number[])[] = [
	[0xfa, 0x49, 0x7b, 0x1c, 0xf9, 0x4d, 0x83, 0x0a],
	[0x3a, 0xe3, 0x87, 0xc2, 0xbd, 0x1e, 0xa6, 0xfe],
];

/**
 * `PpOpener.DecryptIndex`: the places of the index of the engine, of the cipher of its own. The first key
 * stands of the second one, of every place of the file of the first standing behind the count of the places
 * of the index itself; every call begins of the keys as they stand.
 */
export function decryptPpIndex(
	data: Buffer,
	position: number,
	length: number,
): void {
	const first = PP_INDEX_KEYS[0] ?? [];
	const second = PP_INDEX_KEYS[1] ?? [];
	const places = [...first];
	for (let at = 0; at < length; at += 1) {
		const which = at & 7;
		places[which] = ((places[which] ?? 0) + (second[which] ?? 0)) & 0xff;
		data[position + at] = (data[position + at] ?? 0) ^ (places[which] ?? 0);
	}
}

/** The head of an archive of the engine, of the walk of the counts of the index itself. */
export interface PpHeader {
	version: number;
	method: number;
	count: number;
}

/** `PpOpener.TryOpen`: the counts of the head of an archive of the engine. */
export function readPpHeader(data: Buffer): PpHeader | undefined {
	if (data.length < HEAD_OFFSET + HEAD_PLACES) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const head = Buffer.from(
		data.subarray(HEAD_OFFSET, HEAD_OFFSET + HEAD_PLACES),
	);
	decryptPpIndex(head, VERSION_OFFSET, VERSION_PLACES);
	const version = head.readInt32LE(VERSION_OFFSET);
	decryptPpIndex(head, METHOD_OFFSET, METHOD_PLACES);
	const method = head[METHOD_OFFSET] ?? 0;
	if (method > 4) return undefined;
	decryptPpIndex(head, COUNT_OFFSET, COUNT_PLACES);
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (version < LEAST_VERSION) return undefined;
	return { version, method, count };
}

/** One file of the index of an archive of the engine. */
export interface PpEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

/** `PpOpener.TryOpen`: the files of the index of an archive of the engine, behind the cipher of it. */
export function walkPpIndex(
	data: Buffer,
	header: PpHeader,
	sourceSize: bigint,
): PpEntry[] | undefined {
	const count = header.count;
	const indexSize = count * RECORD_PLACES;
	if (INDEX_OFFSET + indexSize > data.length) return undefined;
	const index = Buffer.from(
		data.subarray(INDEX_OFFSET, INDEX_OFFSET + indexSize),
	);
	decryptPpIndex(index, 0, index.length);
	const entries: PpEntry[] = [];
	for (let at = 0; at < count; at += 1) {
		const base = at * RECORD_PLACES;
		const name = decodeCStringField(index, base, NAME_PLACES);
		const size = BigInt(index.readUInt32LE(base + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(base + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, sourceSize)) return undefined;
		entries.push({ name, offset, size });
	}
	return entries;
}

export const illusionPpDescriptor: FormatDescriptor = {
	id: "illusion-pp-archive",
	name: "Illusion resource archive",
	extensions: ["pp"],
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
			source: "ArcFormats/Illusion/ArcPP.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

async function readPp(
	source: ByteSource,
): Promise<{ header: PpHeader; entries: FixedEntry[] } | undefined> {
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	const header = readPpHeader(data);
	if (!header) return undefined;
	const walked = walkPpIndex(data, header, source.size);
	if (!walked) return undefined;
	const entries: FixedEntry[] = walked.map((entry, id) => ({
		...createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			compressed: false,
			metadata: { method: header.method } as Record<string, unknown>,
		}),
		sizeKnown: true,
	}));
	return { header, entries };
}

export const illusionPpEntryOpener: FixedEntryOpener = async (
	source,
	entry,
) => {
	const method = Number(entry.metadata?.method ?? 0);
	if (SCHEME_METHODS.includes(method)) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"The places of this file of the engine stand of a scheme of the game, which the reference looks up by the name of the game in a table that stands empty in the shipped reference",
		);
	}
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	return Readable.from([data]);
};

export const illusionPpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: illusionPpDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPp(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const walked = await readPp(source);
		if (!walked) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not an archive of the engine of Illusion: its head stands of no word of that engine, or the index of it stands of no walk of this engine",
			);
		}
		return {
			entries: walked.entries,
			metadata: {
				count: walked.entries.length,
				version: walked.header.version,
				method: walked.header.method,
			},
		};
	},
	openEntry: illusionPpEntryOpener,
});
