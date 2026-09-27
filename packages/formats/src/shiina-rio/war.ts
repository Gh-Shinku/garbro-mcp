// Port of GARbro "ArcFormats/ShiinaRio/ArcWARC.cs" (tag "WAR", class WarOpener), GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License. The resource archives of the engine of Shiina Rio
// of a count of the version of one hundred and ten.
//
// Two rows of the reference carry the name `WAR`: `ArcWARC1.0.cs` (class `War0Opener`, the shape of the head
// `WARC 1.0`, ported in this project as `shiina-rio-warc`) and `ArcWARC.cs` (class `WarOpener`, the head
// `WARC 1.<digit>`, this one). The head of the second stands of the count of the version of the engine at
// the fourth place of the file (`<digit>` being the count of the version over ten) and of the place of the
// index, a count of the file exclusive-or'ed with `0xF182AD82`; the index then stands of a cipher of its own,
// the count of the places of the file of the index over every word of it.
//
// What stands behind that cipher differs with the count of the version, and only the counts of **one hundred
// and ten and below** stand of no further walk at all: `Decoder.DoEncryption` answers at once for a count of
// the version below one hundred and twenty (`if (data_length < 3 || WarcVersion < 120) return`), so such an
// index stands of the count alone and the places of the files of the archive stand as they stand. Every
// count above that stands of a scheme of the game (`QueryEncryption`) and of the 1314 lines of
// `WarcEncryption.cs`, which this port does not carry: such an archive is not told here at all, which is what
// the reference does as well where it holds no scheme of the game.
//
// The places of a file of the count one hundred and ten stand of walks of the file itself (`UnpackYH1`,
// `UnpackYPK` and `UnpackYLZ`, named by the word of the head of the file), which this port does not carry
// either: the places of such a file stand handed over as they stand.

import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";

const BASELINE_COMMIT = "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0";

/** `WarOpener.Signature`: the word of the head of an archive of this shape. */
const SIGNATURE = Buffer.from("WARC", "latin1");
/** `WarOpener.TryOpen`: the count of the version of the engine at the fourth place of the file. */
const VERSION_AT = 4;
const VERSION_WORD = " 1.";
const VERSION_DIGIT_AT = 7;
const VERSION_DIGIT_BASE = 0x30;
const LEAST_DIGIT = 1;
const MOST_DIGIT = 7;
const VERSION_BASE = 100;
const VERSION_STEP = 10;
/** The count of the version this port carries; above it the index stands of a scheme of the game. */
const CARRIED_VERSION = 110;
/** `WarOpener.TryOpen`: the place of the index, of the count of the file. */
const INDEX_KEY = 0xf182ad82;
const INDEX_AT = 8;
/** `Decoder.GetMaxIndexLength`: the counts of a name and of the places of an entry, and of the entries. */
const ENTRY_NAME_PLACES = 0x10;
const ENTRY_PLACES = 0x18;
const MOST_ENTRIES = 8192;
const LEAST_INDEX_PLACES = 8;
/** The places of a record of the index behind the name of it. */
const OFFSET_AT = 0;
const SIZE_AT = 4;
const UNPACKED_AT = 8;
const FILE_TIME_AT = 12;
const FLAGS_AT = 20;
const RECORD_TAIL = 0x18;

/** One file of the index of an archive of the engine. */
export interface ShiinaWarEntry {
	name: string;
	offset: bigint;
	size: bigint;
	unpackedSize: bigint;
	fileTime: bigint;
	flags: number;
}

/** `WarOpener.TryOpen`: the head of an archive of the engine, of the count of the version of it. */
export function readWarHeader(
	data: Buffer,
): { version: number; indexOffset: number } | undefined {
	if (data.length < INDEX_AT + 4) return undefined;
	if (!data.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if (
		data.toString("latin1", VERSION_AT, VERSION_AT + VERSION_WORD.length) !==
		VERSION_WORD
	) {
		return undefined;
	}
	const digit = (data[VERSION_DIGIT_AT] ?? 0) - VERSION_DIGIT_BASE;
	if (digit < LEAST_DIGIT || digit > MOST_DIGIT) return undefined;
	const version = VERSION_BASE + digit * VERSION_STEP;
	if (version > CARRIED_VERSION) return undefined;
	return {
		version,
		indexOffset: (INDEX_KEY ^ data.readUInt32LE(INDEX_AT)) >>> 0,
	};
}

/** `Decoder.XorIndex`, of the count of the version one hundred and ten: every word of the index. */
export function decryptWarIndex(index: Buffer, indexOffset: number): void {
	const words = Math.trunc(index.length / 4);
	for (let at = 0; at < words; at += 1) {
		const place = at * 4;
		index.writeUInt32LE((index.readUInt32LE(place) ^ indexOffset) >>> 0, place);
	}
}

/** `WarOpener.TryOpen`: the files of the index of an archive of the count one hundred and ten. */
export function walkWarIndex(
	index: Buffer,
	indexOffset: number,
	maxOffset: bigint,
): ShiinaWarEntry[] | undefined {
	const places = Math.min(
		(ENTRY_NAME_PLACES + ENTRY_PLACES) * MOST_ENTRIES,
		index.length,
	);
	if (places < LEAST_INDEX_PLACES) return undefined;
	const decrypted = Buffer.from(index.subarray(0, places));
	decryptWarIndex(decrypted, indexOffset);
	const entries: ShiinaWarEntry[] = [];
	const names = new Set<string>();
	const step = ENTRY_NAME_PLACES + RECORD_TAIL;
	for (let at = 0; at + step <= places; at += step) {
		const field = decrypted.subarray(at, at + ENTRY_NAME_PLACES);
		const name = decodeCStringField(decrypted, at, ENTRY_NAME_PLACES);
		const record = at + ENTRY_NAME_PLACES;
		const offset = BigInt(decrypted.readUInt32LE(record + OFFSET_AT));
		const size = BigInt(decrypted.readUInt32LE(record + SIZE_AT));
		const unpackedSize = BigInt(decrypted.readUInt32LE(record + UNPACKED_AT));
		const fileTime = decrypted.readBigInt64LE(record + FILE_TIME_AT);
		const flags = decrypted.readUInt32LE(record + FLAGS_AT);
		if (!checkPlacement(offset, size, maxOffset)) return undefined;
		// `WarOpener.TryOpen`: a file of no name, of a name of no word of its own, and of a name already
		// read stands of no file of the listing.
		if (0 !== name.length && (field[0] ?? 0x80) < 0x80 && !names.has(name)) {
			names.add(name);
			entries.push({ name, offset, size, unpackedSize, fileTime, flags });
		}
	}
	return 0 === entries.length ? undefined : entries;
}

export const warDescriptor: FormatDescriptor = {
	id: "shiina-rio-war",
	name: "Shiina Rio engine resource archive",
	extensions: ["warc"],
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
			source: "ArcFormats/ShiinaRio/ArcWARC.cs",
			license: "MIT",
			commit: BASELINE_COMMIT,
		},
	],
};

async function readWar(
	source: ByteSource,
): Promise<{ version: number; entries: ShiinaWarEntry[] } | undefined> {
	if (source.size > 0xffffffffn) return undefined;
	const data = Buffer.from(await source.readAt(0n, Number(source.size)));
	const header = readWarHeader(data);
	if (!header) return undefined;
	const indexOffset = header.indexOffset;
	if (BigInt(indexOffset) >= source.size) return undefined;
	const available = Number(source.size) - indexOffset;
	const walked = walkWarIndex(
		data.subarray(indexOffset, indexOffset + available),
		indexOffset,
		source.size,
	);
	if (!walked) return undefined;
	return { version: header.version, entries: walked };
}

export const warEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	return Readable.from([data]);
};

export const warFormat: ArchiveFormat = defineFixedArchive({
	descriptor: warDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE }],
		// The shape of the head `WARC 1.0` stands of `ArcWARC1.0.cs` and is ported beside this one.
		priority: -1,
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWar(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const walked = await readWar(source);
		if (!walked) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Not an archive of the engine of Shiina Rio of a walk of this port",
			);
		}
		const entries: FixedEntry[] = walked.entries.map((entry, id) => ({
			...createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: entry.size,
				compressed: entry.size !== entry.unpackedSize,
				metadata: {
					unpackedSize: entry.unpackedSize.toString(),
					fileTime: entry.fileTime.toString(),
					flags: entry.flags,
				} as Record<string, unknown>,
			}),
			sizeKnown: true,
		}));
		return {
			entries,
			metadata: { count: entries.length, version: walked.version },
		};
	},
	openEntry: warEntryOpener,
});
