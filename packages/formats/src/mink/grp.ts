// Format reference: GARbro Legacy/Mink/ArcMINK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COUNT_OFFSET = 0;
const INDEX_OFFSET_OFFSET = 4;
const NAME_SIZE = 0x18;
const RECORD_SIZE = 0x20;
const SCRIPT_EXTENSION = "msc";
const SCRIPT_MARKER = Buffer.from("MADSCR", "ascii");
const SCRIPT_ID_OFFSET = 8;
/** GARbro `GrpOpener.KnownScriptKeys`: script ids mapped to their XOR key. */
const SCRIPT_KEYS = new Map<number, number>([
	[0x7e83, 0x66],
	[0x9383, 0x77],
	[0x4e83, 0x88],
	[0xbe82, 0x99],
	[0xa282, 0xaa],
	[0xce82, 0xbb],
	[0xad82, 0xcc],
	[0xcd82, 0xdd],
	[0xc282, 0xee],
]);
/** GARbro starts the script XOR behind the 0x20-byte script header. */
const SCRIPT_DATA_OFFSET = 0x20;

export const minkGrpDescriptor: FormatDescriptor = {
	id: "mink-grp",
	name: "Mink resource archive",
	extensions: [""],
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
			source: "Legacy/Mink/ArcMINK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro `GrpOpener.TryOpen`: the index offset lives at 4 and records are 0x20 bytes wide. */
async function readMinkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET_OFFSET + 4);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_OFFSET));
	if (indexOffset < 8n || indexOffset >= source.size) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	return entries;
}

/** GARbro `GrpOpener.OpenEntry`: `MADSCR` scripts are XOR-decrypted with a per-id key. */
const minkEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (
		sourceExtension(entry.path) !== SCRIPT_EXTENSION ||
		entry.size < BigInt(SCRIPT_DATA_OFFSET)
	)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	if (!payload.subarray(0, SCRIPT_MARKER.length).equals(SCRIPT_MARKER))
		return Readable.from([payload]);
	const key = SCRIPT_KEYS.get(payload.readUInt16LE(SCRIPT_ID_OFFSET));
	if (key === undefined) return Readable.from([payload]);
	for (
		let position = SCRIPT_DATA_OFFSET;
		position < payload.length;
		position += 1
	)
		payload[position] = (payload[position] ?? 0) ^ key;
	return Readable.from([payload]);
};

export const minkGrpFormat: ArchiveFormat = defineFixedArchive({
	descriptor: minkGrpDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readMinkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readMinkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Mink GRP layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: minkEntryOpener,
});
