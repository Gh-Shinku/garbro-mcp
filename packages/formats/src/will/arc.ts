// Format reference: GARbro "ArcFormats/Will/ArcWILL.cs", classes `ArcOpener`, `ExtRecord`,
// `ArcOptions`, `ArcEntry` and `ArcDirectory`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 4;
const RECORD_SIZE = 0x0c;
const MAX_EXTENSION_COUNT = 0xff;
const MAX_FILE_COUNT = 0xffff;
/** The two name field widths the reference tries, longest first in the archive reader. */
const NAME_SIZES = [9, 13];

interface ExtRecord {
	extension: string;
	count: number;
	dirOffset: number;
}

interface WillEntry {
	name: string;
	offset: bigint;
	size: number;
}

/** `ArcOpener.TryOpen`: a table of extension records, each with its own file list. */
async function readExtRecords(
	source: ByteSource,
): Promise<ExtRecord[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const count = Buffer.from(await source.readAt(0n, 4)).readInt32LE(0);
	if (count <= 0 || count > MAX_EXTENSION_COUNT) return undefined;
	if (BigInt(HEADER_SIZE) + BigInt(count * RECORD_SIZE) > source.size)
		return undefined;
	const records: ExtRecord[] = [];
	for (let index = 0; index < count; index += 1) {
		const headerOffset = HEADER_SIZE + index * RECORD_SIZE;
		const raw = Buffer.from(
			await source.readAt(BigInt(headerOffset), RECORD_SIZE),
		);
		const extension = decodeCStringField(raw, 0, 4).toLowerCase();
		const fileCount = raw.readInt32LE(4);
		const dirOffset = raw.readUInt32LE(8);
		if (fileCount <= 0 || fileCount > MAX_FILE_COUNT) return undefined;
		if (BigInt(dirOffset) <= BigInt(headerOffset)) return undefined;
		if (BigInt(dirOffset) > source.size) return undefined;
		records.push({ extension, count: fileCount, dirOffset });
	}
	return records;
}

/**
 * `ArcOpener.ReadFileList`: names are fixed width fields, optionally with the extension replaced by
 * the one from the record. The reference retries the whole list with the other name width when any
 * single entry fails.
 */
async function readFileList(
	source: ByteSource,
	records: ExtRecord[],
	nameSize: number,
): Promise<WillEntry[] | undefined> {
	const entries: WillEntry[] = [];
	for (const record of records) {
		let dirOffset = record.dirOffset;
		for (let index = 0; index < record.count; index += 1) {
			const recordSize = nameSize + 8;
			if (BigInt(dirOffset) + BigInt(recordSize) > source.size)
				return undefined;
			const raw = Buffer.from(
				await source.readAt(BigInt(dirOffset), recordSize),
			);
			const rawName = decodeCStringField(raw, 0, nameSize);
			if (rawName.length === 0) return undefined;
			let name = rawName.toLowerCase();
			if (record.extension.length > 0)
				name = changeExtension(name, record.extension);
			const size = raw.readUInt32LE(nameSize);
			const offset = raw.readUInt32LE(nameSize + 4);
			if (!checkPlacement(BigInt(offset), BigInt(size), source.size))
				return undefined;
			entries.push({ name, offset: BigInt(offset), size });
			dirOffset += recordSize;
		}
	}
	return entries;
}

async function buildWillEntries(
	source: ByteSource,
): Promise<{ entries: WillEntry[]; nameSize: number } | undefined> {
	const records = await readExtRecords(source);
	if (!records) return undefined;
	for (const nameSize of NAME_SIZES) {
		const entries = await readFileList(source, records, nameSize);
		if (entries) return { entries, nameSize };
	}
	return undefined;
}

/** A byte rotate right inside the byte, mirroring `Binary.RotByteR (value, 2)`. */
function rotateByteRight2(value: number): number {
	return (((value >>> 2) | (value << 6)) & 0xff) >>> 0;
}

/** `ArcOpener.IsScriptFile`. */
function isScriptFile(name: string): boolean {
	const extension = sourceExtension(name).toLowerCase();
	return extension === "scr" || extension === "wsc";
}

export const willArcDescriptor: FormatDescriptor = {
	id: "will-arc",
	name: "Will Co. game engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Will/ArcWILL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const willArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: willArcDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await buildWillEntries(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const built = await buildWillEntries(source);
		if (!built)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Will ARC index");
		const fixed: FixedEntry[] = built.entries.map((entry, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(entry.name),
				offset: entry.offset,
				size: BigInt(entry.size),
			}),
		);
		return {
			entries: fixed,
			metadata: { entryCount: fixed.length, nameSize: built.nameSize },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		if (entry.size === 0n) return Readable.from([]);
		const offset = entry.offset ?? 0n;
		const size = Number(entry.size);
		if (!isScriptFile(entry.path)) {
			return source.createReadStream(offset, entry.size);
		}
		// Scripts are stored with every byte rotated left and are decoded the other way round.
		const data = Buffer.from(await source.readAt(offset, size));
		for (let index = 0; index < data.length; index += 1)
			data[index] = rotateByteRight2(data[index] ?? 0);
		return Readable.from([data]);
	},
});
