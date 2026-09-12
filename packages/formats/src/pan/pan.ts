// Format reference: GARbro Legacy/Pan/ArcPAN.cs
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

const SIGNATURE = Buffer.from("Pan ver 1.00", "ascii");
const COUNT_OFFSET = 0x10;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x2c;
const UNPACKED_SIZE_OFFSET = 0x20;
const OFFSET_OFFSET = 0x24;
const SIZE_OFFSET = 0x28;

export const panDescriptor: FormatDescriptor = {
	id: "pan",
	name: "Pan engine resource archive",
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
			source: "Legacy/Pan/ArcPAN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const panEntryOpener: FixedEntryOpener = async (source, entry) => {
	const declared = entry.metadata?.unpackedSize;
	const unpackedSize = Number(
		typeof declared === "string" ? declared : entry.size,
	);
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Pan entry declares an invalid unpacked size",
		);
	}
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([
		inflateLzss(compressed, { outputLength: unpackedSize }),
	]);
};

interface PanHeader {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<PanHeader | undefined> {
	if (source.size < BigInt(COUNT_OFFSET + 4)) return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = BigInt(count * RECORD_SIZE);
	if (indexSize > source.size) return undefined;
	const indexOffset = source.size - indexSize;
	if (indexOffset < BigInt(COUNT_OFFSET + 4)) return undefined;
	return { count, indexOffset };
}

async function readPan(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Pan signature");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Pan entry has an empty name");
		}
		const unpackedSize = BigInt(
			index.readUInt32LE(recordOffset + UNPACKED_SIZE_OFFSET),
		);
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Pan entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				compressed: true,
				metadata: { packed: true, unpackedSize: unpackedSize.toString() },
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const panFormat: ArchiveFormat = defineFixedArchive({
	descriptor: panDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readPan,
	openEntry: panEntryOpener,
});
