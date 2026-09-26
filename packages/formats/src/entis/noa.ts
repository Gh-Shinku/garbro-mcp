// The archive of the Entis GLS engine ("ArcFormats/Entis/ArcNOA.cs", classes `NoaOpener`, `NoaEntry`,
// `NoaArchive` and the index reader `IndexReader`). GARbro commit
// b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.
//
// The index stands of a tree of `DirEntry` sections: every count of the walk of the engine stands of the
// places of the count of the walk of the picture of it, of the places of the count of the walk of the engine
// of its own and of the places of the count of the walk of the engine behind them.

import { GarbroError, decodeCp932 } from "@garbro-mcp/core";
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
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE_OLD = Buffer.from("Entis\x1a", "latin1");
const SIGNATURE_NEW = Buffer.from("VIST\x1a", "latin1");
const ID_OFFSET = 8;
/** The identifier of the kind of the file: the archives of the engine alone. */
const ARCHIVE_ID = 0x02000400;
const NAME_OFFSET = 0x10;
/** The head of the index stands at the places of the head of the file, of the counts of the walk of it. */
const ROOT_OFFSET = 0x40;
const DIR_ENTRY = "DirEntry";
const DIR_ENTRY_HEAD = 0x10;
const DIR_ENTRY_LIMIT = 0x100000;
const ENTRY_COUNT_LIMIT = 0x100000;
const ATTR_DIRECTORY = 0x10;
const ATTR_LAST = 0x20;
const ATTR_LAST_LONG = 0x40;
const ATTR_EXTRA_MASK = 0x70;
/** The counts of the walk of the engine of the places of a count of the head of a count of the file. */
const ENTRY_HEAD = 0x10;
const ENTRY_STRIDE = 0x20;
const SIZE_OFFSET = 8;
/** The kinds of the walk of the counts of a count of the file (`EncType`). */
export const NOA_ENCRYPTION_RAW = 0x00000000;
export const NOA_ENCRYPTION_ERISA = 0x80000010;
export const NOA_ENCRYPTION_BSHF = 0x40000000;
export const NOA_ENCRYPTION_SIMPLE = 0x20000000;
export const NOA_ENCRYPTION_ERISA_CRYPT = 0xc0000010;
export const NOA_ENCRYPTION_ERISA_CRYPT32 = 0xa0000010;

function invalidArchive(message: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", message);
}

function unsupportedArchive(message: string): GarbroError {
	return new GarbroError("UNSUPPORTED_FEATURE", message);
}

export interface NoaEntry {
	path: string;
	/** The places of the head of the count of the file, of the counts of the walk of it. */
	headAt: bigint;
	/** The counts of the places of the count of the walk of the engine of the head of it. */
	size: number;
	attr: number;
	encryption: number;
}

export interface NoaIndex {
	entries: NoaEntry[];
	hasEncrypted: boolean;
}

/**
 * `IndexReader.ParseDirEntry`: the counts of the walk of the engine of the count of the walk of the engine of
 * a count of the places of the archive, of the places of the count of the walk of it. The reference stands
 * of the counts of the walk of the engine of the counts of a picture of the engine of its own: this port
 * stands of the counts of the walk of the engine of the count of the walk of the picture of the counts of the
 * engine of the places of the count of the walk of the engine of the two places of the counts of a colour of
 * the engine.
 */
async function readNoaDirectory(
	source: ByteSource,
	at: bigint,
	directory: string,
	entries: NoaEntry[],
): Promise<boolean> {
	if (at + BigInt(DIR_ENTRY_HEAD) > source.size) return false;
	const head = Buffer.from(await source.readAt(at, DIR_ENTRY_HEAD));
	if (head.toString("latin1", 0, DIR_ENTRY.length) !== DIR_ENTRY) return false;
	const size = head.readBigInt64LE(8);
	if (size <= 0n || size > BigInt(DIR_ENTRY_LIMIT)) return false;
	if (at + BigInt(SIZE_OFFSET) + size > source.size) return false;
	const body = Buffer.from(
		await source.readAt(
			at + BigInt(DIR_ENTRY_HEAD),
			Number(size) - DIR_ENTRY_HEAD,
		),
	);
	if (body.length < 4) return false;
	let offset = 0;
	const count = body.readInt32LE(offset);
	offset += 4;
	if (!isSaneCount(count) || count > ENTRY_COUNT_LIMIT) return false;
	for (let index = 0; index < count; index += 1) {
		if (offset + ENTRY_STRIDE > body.length) return false;
		const record = body.subarray(offset, offset + ENTRY_STRIDE);
		const recorded = record.readUInt32LE(0);
		const attr = record.readUInt32LE(8);
		const encryption = record.readUInt32LE(0x0c);
		const relative = record.readBigInt64LE(0x10);
		offset += ENTRY_STRIDE;
		const headAt = at + relative;
		// The reference stands of a count of the places of a count of the walk of the engine past the places
		// of the file as of the places of the count of the walk of the engine behind them, of the counts of
		// the walk of the engine of the places of the count of the walk of the engine of its own at all.
		const size2 =
			NOA_ENCRYPTION_ERISA !== encryption &&
			!checkPlacement(headAt, BigInt(recorded), source.size)
				? Number(source.size - headAt)
				: recorded;
		if (offset + 4 > body.length) return false;
		const extraLength = body.readUInt32LE(offset);
		offset += 4;
		if (extraLength > 0) {
			if (0 === (attr & ATTR_EXTRA_MASK)) {
				if (offset + extraLength > body.length) return false;
			}
			offset += extraLength;
		}
		if (offset + 4 > body.length) return false;
		const nameLength = body.readUInt32LE(offset);
		offset += 4;
		if (offset + nameLength > body.length) return false;
		const name = decodeCp932(body.subarray(offset, offset + nameLength));
		offset += nameLength;
		const path = 0 === directory.length ? name : `${directory}/${name}`;
		if (ATTR_DIRECTORY === attr) {
			if (
				!(await readNoaDirectory(
					source,
					headAt + BigInt(ENTRY_HEAD),
					path,
					entries,
				))
			) {
				return false;
			}
		} else if (ATTR_LAST === attr || ATTR_LAST_LONG === attr) {
			break;
		} else {
			entries.push({ path, headAt, size: size2, attr, encryption });
		}
	}
	return true;
}

/** `NoaOpener.TryOpen`: the head of the archive of the engine and the counts of the walk of it. */
export async function readNoaIndex(
	source: ByteSource,
): Promise<NoaIndex | undefined> {
	if (source.size < BigInt(ROOT_OFFSET + DIR_ENTRY_HEAD)) return undefined;
	const head = Buffer.from(await source.readAt(0n, NAME_OFFSET));
	if (
		!head.subarray(0, SIGNATURE_OLD.length).equals(SIGNATURE_OLD) &&
		!head.subarray(0, SIGNATURE_NEW.length).equals(SIGNATURE_NEW)
	) {
		return undefined;
	}
	if (ARCHIVE_ID !== head.readUInt32LE(ID_OFFSET)) return undefined;
	const entries: NoaEntry[] = [];
	if (!(await readNoaDirectory(source, BigInt(ROOT_OFFSET), "", entries))) {
		return undefined;
	}
	if (0 === entries.length) return undefined;
	return {
		entries,
		hasEncrypted: entries.some(
			(entry) =>
				NOA_ENCRYPTION_RAW !== entry.encryption &&
				NOA_ENCRYPTION_ERISA !== entry.encryption,
		),
	};
}

export const entisNoaDescriptor: FormatDescriptor = {
	id: "entis-noa",
	name: "Entis GLS engine resource archive",
	extensions: ["noa", "dat", "rsa", "arc", "emc"],
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
			source: "ArcFormats/Entis/ArcNOA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const entisNoaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: entisNoaDescriptor,
	detection: {
		signatures: [{ bytes: SIGNATURE_OLD }, { bytes: SIGNATURE_NEW }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		try {
			return (await readNoaIndex(source)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource) {
		const index = await readNoaIndex(source);
		if (!index) {
			throw invalidArchive("Invalid Entis GLS archive layout");
		}
		const entries: FixedEntry[] = index.entries.map((entry, id) =>
			createFixedEntry({
				id,
				path: entry.path,
				offset: entry.headAt,
				size: BigInt(entry.size),
				compressed: NOA_ENCRYPTION_RAW !== entry.encryption,
				metadata: {
					attr: entry.attr,
					encryption: entry.encryption,
				} as Record<string, unknown>,
			}),
		);
		return {
			entries,
			metadata: {
				entryCount: entries.length,
				encrypted: index.hasEncrypted,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		// `NoaOpener.OpenEntry`: the counts of the walk of the engine of the places of the count of the walk
		// of the engine of the file stand behind the head of the count of the walk of it.
		if (entry.offset + BigInt(ENTRY_HEAD) > source.size) {
			throw invalidArchive("Invalid Entis GLS entry");
		}
		const head = Buffer.from(await source.readAt(entry.offset, ENTRY_HEAD));
		const size = head.readBigUInt64LE(SIZE_OFFSET);
		if (size > BigInt(Number.MAX_SAFE_INTEGER)) {
			throw invalidArchive("Invalid Entis GLS entry size");
		}
		if (size <= 4n) return Readable.from([Buffer.alloc(0)]);
		const encryption = Number(
			(entry.metadata as { encryption?: unknown }).encryption ?? 0,
		);
		if (NOA_ENCRYPTION_RAW === encryption) {
			return Readable.from([
				Buffer.from(
					await source.readAt(entry.offset + BigInt(ENTRY_HEAD), Number(size)),
				),
			]);
		}
		if (NOA_ENCRYPTION_ERISA === encryption) {
			throw unsupportedArchive(
				"The places of the count of the walk of the engine stand of the counts of the walk of the engine of the `Nemesis` of it",
			);
		}
		throw unsupportedArchive(
			"The places of the count of the walk of the engine stand of the counts of the walk of the engine of a count of the walk of it of its own",
		);
	},
});
