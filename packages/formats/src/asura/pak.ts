// Format reference: GARbro Legacy/Asura/ArcPAK.cs
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

const SIGNATURE = Buffer.from("AsuraPak", "binary");
const COUNT_OFFSET = 8;
const INDEX_OFFSET = 12;
const NAME_SIZE = 0x100;
const RECORD_SIZE = 0x10c;
const OFFSET_OFFSET = 0x100;
const UNPACKED_SIZE_OFFSET = 0x104;
const SIZE_OFFSET = 0x108;

export const asuraPakDescriptor: FormatDescriptor = {
	id: "asura-pak",
	name: "Asura engine resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Asura/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isPacked(entry: FixedEntry): boolean {
	return entry.metadata?.packed === true;
}

const asuraEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!isPacked(entry))
		return source.createReadStream(entry.offset, entry.size);
	const declared = entry.metadata?.unpackedSize;
	const unpackedSize = Number(
		typeof declared === "string" ? declared : entry.size,
	);
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Asura PAK entry declares an invalid unpacked size",
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
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readAsuraPak(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Asura PAK signature");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Asura PAK entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const unpackedSize = BigInt(
			index.readUInt32LE(recordOffset + UNPACKED_SIZE_OFFSET),
		);
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Asura PAK entry points outside the archive: ${name}`,
			);
		}
		const packed = size !== unpackedSize;
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

export const asuraPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: asuraPakDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAsuraPak,
	openEntry: asuraEntryOpener,
});
