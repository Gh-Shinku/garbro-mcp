// Format reference: GARBro ArcFormats/MyAdv/ArcPAC.cs, class `PacOpener`.
import { createZlibInflateStream, inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 4;
const NAME_RECORD_SIZE = 12;
const ENTRY_RECORD_SIZE = 12;
const NAME_BUFFER_SIZE = 0x100;

export const myAdvPacDescriptor: FormatDescriptor = {
	id: "myadv-pac",
	name: "MyAdv engine resource archive",
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
			source: "ArcFormats/MyAdv/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const count = (await source.readAt(0n, HEADER_SIZE)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	let position = BigInt(HEADER_SIZE);
	const names: string[] = [];
	for (let id = 0; id < count; id += 1) {
		if (position + BigInt(NAME_RECORD_SIZE) > source.size) return undefined;
		const record = await source.readAt(position, NAME_RECORD_SIZE);
		const nameLength = record.readInt32LE(0);
		const unpackedSize = record.readInt32LE(4);
		const packedSize = record.readInt32LE(8);
		if (nameLength <= 0 || nameLength > NAME_BUFFER_SIZE) return undefined;
		if (unpackedSize < nameLength || unpackedSize > NAME_BUFFER_SIZE)
			return undefined;
		if (packedSize <= 0 || packedSize > NAME_BUFFER_SIZE) return undefined;
		position += BigInt(NAME_RECORD_SIZE);
		if (position + BigInt(packedSize) > source.size) return undefined;
		let decoded: Buffer;
		try {
			decoded = await inflateZlibBuffer(
				await source.readAt(position, packedSize),
			);
		} catch {
			return undefined;
		}
		if (decoded.length < nameLength) return undefined;
		names.push(decodeCp932(decoded.subarray(0, nameLength)));
		position += BigInt(packedSize);
	}
	if (position + BigInt(count * ENTRY_RECORD_SIZE) > source.size)
		return undefined;
	const table = await source.readAt(position, count * ENTRY_RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * ENTRY_RECORD_SIZE;
		const offset = BigInt(table.readUInt32LE(record));
		const packedSize = BigInt(table.readUInt32LE(record + 4));
		const size = BigInt(table.readUInt32LE(record + 8));
		if (!checkPlacement(offset, packedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(names[id] ?? ""),
				offset,
				size,
				packedSize,
				compressed: true,
			}),
		);
	}
	return entries;
}

export const myAdvPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: myAdvPacDescriptor,
	async detect(source) {
		return (await readIndex(source)) !== undefined;
	},
	async read(source) {
		const entries = await readIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid MyAdv PAC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source, entry) {
		return createZlibInflateStream(
			source.createReadStream(entry.offset, entry.packedSize),
		);
	},
});
