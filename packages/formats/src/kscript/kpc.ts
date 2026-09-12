// Format reference: GARbro ArcFormats/KScript/ArcKPC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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

const SIGNATURE = Buffer.from("SCRP", "ascii");
const SECOND_TAG = Buffer.from("ACK1", "ascii");
const COUNT_OFFSET = 8;
const INDEX_SIZE_OFFSET = 0x0c;
const INDEX_OFFSET = 0x20;
const NAME_SIZE = 0x18;
const RECORD_SIZE = 0x20;
const XOR_KEY = 0x45;

export const kpcDescriptor: FormatDescriptor = {
	id: "kscript-kpc",
	name: "KScript engine resource archive",
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
			source: "ArcFormats/KScript/ArcKPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface KpcHeader {
	count: number;
	indexSize: number;
}

async function parseHeader(source: ByteSource): Promise<KpcHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!header.subarray(4, 8).equals(SECOND_TAG)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = header.readUInt32LE(INDEX_SIZE_OFFSET);
	if (BigInt(INDEX_OFFSET) + BigInt(indexSize) > source.size) return undefined;
	return { count, indexSize };
}

async function readKpc(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid KScript KPC signature");
	}
	const { count, indexSize } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	for (let position = 0; position < index.length; position += 1) {
		index[position] = (index[position] ?? 0) ^ XOR_KEY;
	}
	const entries: FixedEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (position + RECORD_SIZE > index.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"KScript KPC index is truncated",
			);
		}
		const field = index.subarray(position, position + NAME_SIZE);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"KScript KPC entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(position + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(position + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`KScript KPC entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
		position += RECORD_SIZE;
	}
	return { entries, metadata: { entryCount: count, indexSize } };
}

export const kpcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kpcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readKpc,
});
