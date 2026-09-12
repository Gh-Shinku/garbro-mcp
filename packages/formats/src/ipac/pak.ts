// Format reference: GARbro ArcFormats/Ipac/ArcIPAC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
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

const SIGNATURE = Buffer.from("IPAC", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x2c;
const OFFSET_OFFSET = 0x24;
const SIZE_OFFSET = 0x28;
const PACKED_TAG = Buffer.from("IEL1", "ascii");
const PACKED_HEADER_SIZE = 8;

export const ipacDescriptor: FormatDescriptor = {
	id: "ipac",
	name: "IPAC resource archive",
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
			source: "ArcFormats/Ipac/ArcIPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const ipacEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.size < BigInt(PACKED_HEADER_SIZE)) {
		return source.createReadStream(entry.offset, entry.size);
	}
	const header = await source.readAt(entry.offset, PACKED_HEADER_SIZE);
	if (!header.subarray(0, 4).equals(PACKED_TAG)) {
		return source.createReadStream(entry.offset, entry.size);
	}
	const unpackedSize = Number(header.readUInt32LE(4));
	if (!Number.isSafeInteger(unpackedSize) || unpackedSize < 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"IPAC entry declares an invalid unpacked size",
		);
	}
	const compressed = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		Number(entry.size - BigInt(PACKED_HEADER_SIZE)),
	);
	return Readable.from([
		inflateLzss(compressed, { outputLength: unpackedSize }),
	]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt16LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readIpac(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid IPAC signature");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "IPAC entry has an empty name");
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`IPAC entry points outside the archive: ${name}`,
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
	}
	return { entries, metadata: { entryCount: count } };
}

export const ipacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ipacDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readIpac,
	openEntry: ipacEntryOpener,
});
