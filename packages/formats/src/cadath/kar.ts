// Format reference: GARbro ArcFormats/Cadath/ArcKAR.cs
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
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { extname } from "node:path";

const SIGNATURE = Buffer.from("KAR\0", "binary");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x0c;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;
const SIZE_OFFSET = 0x20;
const OFFSET_OFFSET = 0x24;

export const karDescriptor: FormatDescriptor = {
	id: "cadath-kar",
	name: "Cadath resource archive",
	extensions: ["bin"],
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
			source: "ArcFormats/Cadath/ArcKAR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const karEntryOpener: FixedEntryOpener = async (source, entry) => {
	const extension = extname(entry.path).toLowerCase();
	let key = 0;
	if (extension === ".ns6") key = Number(entry.size / 7n);
	else if (extension === ".ns5") key = Number(entry.size / 13n);
	if (key === 0) return source.createReadStream(entry.offset, entry.size);
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	for (let position = 0; position < data.length; position += 1) {
		data[position] = (data[position] ?? 0) ^ (key & 0xff);
	}
	return Readable.from([data]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readKar(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Cadath KAR signature");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Cadath KAR entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Cadath KAR entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				compressed: false,
				encrypted: /\.ns[56]$/i.test(name),
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const karFormat: ArchiveFormat = defineFixedArchive({
	descriptor: karDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readKar,
	openEntry: karEntryOpener,
});
