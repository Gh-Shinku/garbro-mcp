// Format reference: GARbro ArcFormats/NSystem/ArcFJSYS.cs, class `FjsysOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("FJSYS", "latin1");
const NAMES_SIZE_FIELD = 0xc;
const COUNT_FIELD = 0x10;
/** The index starts behind the header and every record is 0x10 bytes long. */
const INDEX_OFFSET = 0x54;
const RECORD_SIZE = 0x10;
const NAME_OFFSET_FIELD = 0;
const SIZE_FIELD = 4;
const ENTRY_OFFSET_FIELD = 8;
const SCRIPT_EXTENSION = ".msd";

interface FjsysEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

async function readBytes(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || length < 0) return undefined;
	if (BigInt(offset) + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), length));
}

/**
 * GARbro `FjsysOpener.TryOpen`. The header points at a name blob behind the entry table; every record holds
 * an offset into that blob, the payload size and a 64 bit payload offset.
 */
async function readFjsysIndex(
	source: ByteSource,
): Promise<FjsysEntry[] | undefined> {
	const header = await readBytes(source, 0, INDEX_OFFSET);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const namesSize = header.readUInt32LE(NAMES_SIZE_FIELD);
	const table = await readBytes(source, INDEX_OFFSET, count * RECORD_SIZE);
	if (!table) return undefined;
	const names = await readBytes(
		source,
		INDEX_OFFSET + count * RECORD_SIZE,
		namesSize,
	);
	if (!names) return undefined;
	const entries: FjsysEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameOffset = table.readInt32LE(record + NAME_OFFSET_FIELD);
		if (nameOffset < 0 || nameOffset >= names.length) return undefined;
		const end = names.indexOf(0, nameOffset);
		const name = decodeCp932(
			end === -1 ? names.subarray(nameOffset) : names.subarray(nameOffset, end),
		);
		const size = BigInt(table.readUInt32LE(record + SIZE_FIELD));
		const offset = table.readBigInt64LE(record + ENTRY_OFFSET_FIELD);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({ name, offset, size });
	}
	if (entries.length === 0) return undefined;
	return entries;
}

function toFixedEntries(entries: readonly FjsysEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			metadata: {
				type: entry.name.toLowerCase().endsWith(SCRIPT_EXTENSION)
					? "script"
					: "data",
			},
		}),
	);
}

export const fjsysDescriptor: FormatDescriptor = {
	id: "n-system-fjsys",
	name: "NSystem engine resource archive",
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
			source: "ArcFormats/NSystem/ArcFJSYS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fjsysFormat = defineFixedArchive({
	descriptor: fjsysDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFjsysIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readFjsysIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid NSystem FJSYS layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	/**
	 * `FjsysOpener.OpenEntry` only decrypts `.msd` scripts, and only when a per-title password is known. The
	 * port has no password database, so every entry is handed back as it is stored.
	 */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		return Readable.from([
			Buffer.from(await source.readAt(entry.offset, Number(entry.size))),
		]);
	},
});
