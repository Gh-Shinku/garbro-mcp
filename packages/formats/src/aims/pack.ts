// Format reference: GARbro ArcFormats/Aims/ArcPACK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { Blowfish } from "@garbro-mcp/codecs";
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

const SIGNATURE = Buffer.from("PACK", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x40;
const RECORD_SIZE = 0x50;
const OFFSET_OFFSET = 0x48;
const SIZE_OFFSET = 0x4c;
const PACKED_TAG = Buffer.from("LZSS", "ascii");
const PACKED_HEADER_SIZE = 8;
const BLOCK_SIZE = 8;

/** AIMS default key from GARbro's Aims/ArcPACK.cs. */
const DEFAULT_KEY = Buffer.from([
	0x7d, 0x73, 0xf6, 0xe4, 0xf5, 0x81, 0x5f, 0x7c, 0x78, 0x30, 0xc2, 0x36, 0xea,
	0x3e, 0x8a, 0x76, 0xf7, 0xe0, 0x48, 0xb5, 0x85, 0xd7, 0x77, 0x49, 0x4c, 0x3d,
	0xf5, 0x0c, 0xbb, 0xfb, 0x2e, 0x44, 0xfe, 0x25, 0xb7, 0xeb, 0xc7, 0xd9, 0x33,
	0xab, 0xa8, 0x2c, 0x64, 0xe8, 0xf0, 0xbd, 0xeb, 0x8d, 0x9d, 0x1d, 0xa2, 0xfc,
	0x59, 0x09, 0xaa, 0xa4,
]);

export const aimsPackDescriptor: FormatDescriptor = {
	id: "aims-pack",
	name: "AIMS engine resource archive",
	extensions: ["p", "mus", "pac"],
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
			source: "ArcFormats/Aims/ArcPACK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const aimsEntryOpener: FixedEntryOpener = async (source, entry) => {
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
			"AIMS PACK entry declares an invalid unpacked size",
		);
	}
	const encryptedLength = Number(entry.size - BigInt(PACKED_HEADER_SIZE));
	if (encryptedLength % BLOCK_SIZE !== 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"AIMS PACK encrypted payload is not block aligned",
		);
	}
	const encrypted = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		encryptedLength,
	);
	const decrypted = new Blowfish(DEFAULT_KEY).decipherBlocks(encrypted);
	if (decrypted.length < unpackedSize) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"AIMS PACK payload is shorter than the declared unpacked size",
		);
	}
	return Readable.from([decrypted.subarray(0, unpackedSize)]);
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

async function readAimsPack(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AIMS PACK signature");
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
			continue;
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`AIMS PACK entry points outside the archive: ${name}`,
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
	return { entries, metadata: { entryCount: entries.length } };
}

export const aimsPackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aimsPackDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAimsPack,
	openEntry: aimsEntryOpener,
});
