// Format reference: GARbro ArcFormats/ArcARCX.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ARCX", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 0x10;
const NAME_SIZE = 100;
const RECORD_SIZE = 0x1c;
const OFFSET_OFFSET = 0;
const SIZE_OFFSET = 4;
const UNPACKED_SIZE_OFFSET = 8;
const PACKED_OFFSET = 0x13;

export const arcxDescriptor: FormatDescriptor = {
	id: "arcx",
	name: "ARCX resource archive",
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
			source: "ArcFormats/ArcARCX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isPacked(entry: FixedEntry): boolean {
	return entry.metadata?.packed === true;
}

const arcxEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!isPacked(entry))
		return source.createReadStream(entry.offset, entry.size);
	const declared = entry.metadata?.unpackedSize;
	const unpackedSize = Number(
		typeof declared === "string" ? declared : entry.size,
	);
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"ARCX entry declares an invalid unpacked size",
		);
	}
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([
		inflateLzss(compressed, { outputLength: unpackedSize }),
	]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const recordSize = NAME_SIZE + RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + count * recordSize) > source.size) return undefined;
	return count;
}

async function readArcx(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid ARCX signature");
	}
	const recordSize = NAME_SIZE + RECORD_SIZE;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * recordSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * recordSize;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "ARCX entry has an empty name");
		}
		const dataOffset = recordOffset + NAME_SIZE;
		const offset = BigInt(index.readUInt32LE(dataOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(dataOffset + SIZE_OFFSET));
		const unpackedSize = BigInt(
			index.readUInt32LE(dataOffset + UNPACKED_SIZE_OFFSET),
		);
		const packed = (index[dataOffset + PACKED_OFFSET] ?? 0) !== 0;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`ARCX entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				compressed: packed,
				metadata: { packed, unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const arcxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: arcxDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readArcx,
	openEntry: arcxEntryOpener,
});
