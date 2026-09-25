// Format reference: GARBro "ArcFormats/MangaGamer/ArcMGPK.cs", class `MgpkOpener`. The file also carries
// `Mgpk0Opener`, the older version of the same archive, which is ported beside this one as
// `mangagamer-mgpk0`: the two share their word and are told apart by the version in their head, so a version
// of nothing belongs to that format and this one reads every version from one up.
//
// The reference can key the names of an archive - `KnownKeys` stands under a scheme of ready made keys and
// `QueryKey` asks a user for one otherwise - and its `OpenEntry` then unwraps `png` and `txt` entries with a
// key and an LZF stream. A stock build carries **no** keys at all, so the plain way is the only one it
// reaches; that is the way this port keeps, and the names an archive would key are reported instead.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	defineFixedArchive,
	type FixedEntry,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
} from "../shared/fixed-archive.js";

/** The word every archive of this engine opens with, and the version that tells its two layouts apart. */
const SIGNATURE = Buffer.from("MGPK", "latin1");
const VERSION_FIELD = 4;
const COUNT_FIELD = 8;
const INDEX_BASE = 0x0c;
/** Every record of the index is forty eight bytes: a name, a place and a length. */
const ENTRY_SIZE = 0x30;
const NAME_LENGTH_FIELD = 0;
const NAME_FIELD = 1;
const PLACE_FIELD = 0x20;
const SIZE_FIELD = 0x24;
/** The names the reference would key, and therefore ask a user about. */
const KEYED_EXTENSIONS = ["png", "txt"];
/** The name of the archive this engine writes. */
const ARCHIVE_EXTENSIONS = ["pac"];

export interface MgpkEntry {
	name: string;
	offset: number;
	size: number;
}

export interface MgpkIndex {
	entries: MgpkEntry[];
	/** Whether the archive holds a name the reference would key. */
	holdsKeyedNames: boolean;
}

function invalid(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

/**
 * `MgpkOpener.TryOpen`: the head names the version and how many records stand behind it, and every record
 * holds the length of its name and the name itself - read as text of its own - with the place and the length
 * of the entry after them. A place is kept only when the whole entry stands inside the archive.
 */
export function readMgpkIndex(
	data: Buffer,
	maxOffset: bigint,
): MgpkIndex | undefined {
	if (data.length < INDEX_BASE) return undefined;
	const version = data.readInt32LE(VERSION_FIELD);
	if (version < 1) return undefined;
	const count = data.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	if (INDEX_BASE + count * ENTRY_SIZE > data.length) return undefined;
	const entries: MgpkEntry[] = [];
	let holdsKeyedNames = false;
	for (let number = 0; number < count; number += 1) {
		const at = INDEX_BASE + number * ENTRY_SIZE;
		const nameLength = data[at + NAME_LENGTH_FIELD] ?? 0;
		// The name is read as its own text, and the reference reads it for as many bytes as the record
		// names - which may reach past the record itself - so this port bounds it by the file.
		const nameEnd = Math.min(at + NAME_FIELD + nameLength, data.length);
		const name = data.toString("utf8", at + NAME_FIELD, nameEnd);
		const offset = data.readUInt32LE(at + PLACE_FIELD);
		const size = data.readUInt32LE(at + SIZE_FIELD);
		if (!checkPlacement(BigInt(offset), BigInt(size), maxOffset)) {
			return undefined;
		}
		if (KEYED_EXTENSIONS.includes(sourceExtension(name))) {
			holdsKeyedNames = true;
		}
		entries.push({ name, offset, size });
	}
	return { entries, holdsKeyedNames };
}

async function readHead(source: ByteSource): Promise<Buffer> {
	const size = Number(source.size);
	return Buffer.from(await source.readAt(0n, Math.min(size, 0x40)));
}

async function readStored(source: ByteSource): Promise<Buffer> {
	return Buffer.from(await source.readAt(0n, Number(source.size)));
}

export const mgpkDescriptor: FormatDescriptor = {
	id: "mangagamer-mgpk",
	name: "MG resource archive",
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
			source: "ArcFormats/MangaGamer/ArcMGPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const mgpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: mgpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(INDEX_BASE)) return false;
		// The version and the count stand in the head alone, so only that much is read to tell.
		const head = await readHead(source);
		if (!head.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return false;
		const version = head.readInt32LE(VERSION_FIELD);
		if (version < 1) return false;
		if (!isSaneCount(head.readInt32LE(COUNT_FIELD))) return false;
		return readMgpkIndex(await readStored(source), source.size) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = readMgpkIndex(await readStored(source), source.size);
		if (!index) throw invalid("Not an MG resource archive");
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
			metadata: {
				extension: sourceExtension(sourcePath),
				entryCount: entries.length,
				holdsKeyedNames: index.holdsKeyedNames,
			},
		};
	},
	async openEntry(source: ByteSource, entry) {
		// Every entry of a plain archive of this engine stands in it as it is: the way the reference unwraps
		// a `txt` entry stands behind a key that a stock build does not carry.
		return Readable.from([
			Buffer.from(
				await source.readAt(BigInt(entry.offset), Number(entry.size)),
			),
		]);
	},
});
