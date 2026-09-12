// Format reference: GARbro ArcFormats/Abel/ArcFPK.cs
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

const SIGNATURE = Buffer.from("FPK\0", "binary");
const COUNT_OFFSET = 4;
const NAMES_SIZE_OFFSET = 8;
const INDEX_OFFSET = 12;
const RECORD_SIZE = 8;
const MAXIMUM_NAME_LENGTH = 0x400;

export const abelFpkDescriptor: FormatDescriptor = {
	id: "abel-fpk",
	name: "Abel resource archive",
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
			source: "ArcFormats/Abel/ArcFPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface AbelHeader {
	count: number;
	namesSize: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<AbelHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const namesSize = header.readUInt32LE(NAMES_SIZE_OFFSET);
	if (namesSize === 0 || BigInt(namesSize) >= source.size) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return { count, namesSize };
}

async function readAbelFpk(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Abel FPK signature");
	}
	const { count, namesSize } = header;
	const namesOffset = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (namesOffset + BigInt(namesSize) > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "Abel FPK names are truncated");
	}
	const names = await source.readAt(namesOffset, namesSize);
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	let namePosition = 0;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const nameEnd = names.indexOf(0, namePosition);
		if (nameEnd === -1) {
			throw new GarbroError("INVALID_ARCHIVE", "Abel FPK names are truncated");
		}
		const name = decodeCp932(names.subarray(namePosition, nameEnd));
		namePosition = nameEnd + 1;
		if (name.length === 0 || name.length > MAXIMUM_NAME_LENGTH) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Abel FPK entry has an invalid name",
			);
		}
		const recordOffset = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Abel FPK entry points outside the archive: ${name}`,
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

export const abelFpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abelFpkDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAbelFpk,
});
