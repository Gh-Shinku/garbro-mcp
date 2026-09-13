// Format reference: GARbro ArcFormats/ArcIKS.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("NPSR", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x28;
const NAME_SIZE_OFFSET = 0x1c;
const OFFSET_OFFSET = 0x20;
/** GARbro `IksOpener.KnownKeys` ships a single entry whose value is used for every payload. */
const PAYLOAD_KEY = 0x66;
const MAX_COUNT = 0xfffff;
const NAME_LIMIT = 0x17;

export const iksDescriptor: FormatDescriptor = {
	id: "xiks-iks",
	name: "X[iks] resource archive",
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
			source: "ArcFormats/ArcIKS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `IksOpener.TryOpen`. Records are 0x28 bytes and start with a name length byte followed by
 * a CP932 name, the stored size at +0x1c, and the data offset at +0x20. Every payload is XORed with
 * the single shipped key.
 */
async function readIksIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > MAX_COUNT) return undefined;
	const indexSize = RECORD_SIZE * count;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const nameBytes = (index[record] ?? 0) & 0xff;
		const nameLength = Math.min(NAME_LIMIT, nameBytes);
		if (1 + nameLength > RECORD_SIZE) return undefined;
		const rawName = index.subarray(record + 1, record + 1 + nameLength);
		// GARbro decodes the whole clamped field, so padded names would keep their NUL bytes. The
		// port stops at the terminator instead, which keeps such entries extractable.
		const terminator = rawName.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? rawName : rawName.subarray(0, terminator),
		);
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		if (offset < dataOffset || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
			}),
		);
	}
	return entries;
}

/** GARbro `IksOpener.OpenEntry`: payloads are XORed with the known key. */
const iksEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = (payload[position] ?? 0) ^ PAYLOAD_KEY;
	return Readable.from([payload]);
};

export const iksFormat: ArchiveFormat = defineFixedArchive({
	descriptor: iksDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readIksIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIksIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid X[iks] IKS layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: iksEntryOpener,
});
