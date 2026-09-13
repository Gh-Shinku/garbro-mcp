// Format reference: GARBro Legacy/Alterna/ArcBIN.cs, class `BinOpener`.
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
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const LIST_EXTENSION = "lst";
const LIST_SIGNATURE = Buffer.from("ARC1.00", "ascii");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
/** Stored names are inverted up to the first NUL. */
const NAME_KEY = 0x80;
/** Packed payloads begin with this marker and keep the LZSS frame one position higher. */
const LZSS_MARKER = Buffer.from("LZSS", "ascii");
const LZSS_HEADER_SIZE = 8;
const LZSS_FRAME_INIT_POSITION = 0xff0;

/**
 * GARBro `BinOpener.TryOpen`. The archive itself carries no index: the reference derives a sibling
 * `.lst` file name by replacing the archive extension and refuses archives that already use `.lst`.
 * That list starts with the `ARC1.00` marker, a record count at 0x08 and 0x30-byte records at 0x10.
 *
 * A record holds a packing flag, the unpacked size, the stored size, the payload offset and a 0x20-byte
 * name whose bytes are inverted up to the first NUL. Offsets are checked against the archive, not
 * against the list.
 *
 * Packed entries are only decoded when their stored data actually starts with the `LZSS` marker, so the
 * port probes that marker while parsing the list and reads the unpacked size from the record either
 * way; without the marker the payload is served verbatim.
 */
async function readAlternaIndex(
	source: ByteSource,
	sourcePath?: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath ?? "") === LIST_EXTENSION) return undefined;
	const listName = changeExtension(basename(sourcePath ?? ""), LIST_EXTENSION);
	const list = await readCompanionFile(sourcePath ?? "", listName);
	if (!list || list.length < INDEX_OFFSET) return undefined;
	if (!list.subarray(0, LIST_SIGNATURE.length).equals(LIST_SIGNATURE))
		return undefined;
	const count = list.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (INDEX_OFFSET + count * RECORD_SIZE > list.length) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		const encrypted = list.subarray(record + 0x10, record + 0x10 + NAME_SIZE);
		const nameBytes = Buffer.from(encrypted);
		for (let position = 0; position < nameBytes.length; position += 1) {
			if ((nameBytes[position] ?? 0) === 0) break;
			nameBytes[position] = (nameBytes[position] ?? 0) ^ NAME_KEY;
		}
		const name = decodeCStringField(nameBytes, 0, NAME_SIZE);
		const packed = list.readInt32LE(record) !== 0;
		const unpackedSize = BigInt(list.readUInt32LE(record + 4));
		const storedSize = BigInt(list.readUInt32LE(record + 8));
		const offset = BigInt(list.readUInt32LE(record + 0xc));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		if (
			packed &&
			storedSize >= BigInt(LZSS_HEADER_SIZE) &&
			(await source.readAt(offset, LZSS_MARKER.length)).equals(LZSS_MARKER)
		) {
			const entry = createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: offset + BigInt(LZSS_HEADER_SIZE),
				size: unpackedSize,
				packedSize: storedSize - BigInt(LZSS_HEADER_SIZE),
				compressed: true,
			});
			// The LZSS stream decodes to its own end, so the declared size stays a hint.
			entry.sizeKnown = false;
			entries.push(entry);
			continue;
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
	}
	return entries;
}

/** GARbro `BinOpener.OpenEntry`: `LZSS` payloads use a frame that starts at 0xFF0. */
const alternaEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([
		inflateLzssAll(stored, {
			frameInitPosition: LZSS_FRAME_INIT_POSITION,
		}),
	]);
};

export const alternaBinDescriptor: FormatDescriptor = {
	id: "alterna-bin",
	name: "Alterna resource archive",
	extensions: ["bin"],
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
			source: "Legacy/Alterna/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const alternaBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alternaBinDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath?: string): Promise<boolean> {
		return (await readAlternaIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAlternaIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Alterna BIN layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: alternaEntryOpener,
});
