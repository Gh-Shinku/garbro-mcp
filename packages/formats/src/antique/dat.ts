// Format reference: GARbro ArcFormats/Antique/ArcDAT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
import { decodeCp932 } from "@garbro-mcp/core";

const SIGNATURE = Buffer.from("ACHV", "ascii");
const COUNT_OFFSET = 0x0c;
const NAMES_LENGTH_OFFSET = 0x10;
const INDEX_OFFSET = 0x14;
const RECORD_SIZE = 0x10;

export const antiqueDatDescriptor: FormatDescriptor = {
	id: "antique-dat",
	name: "An*tique resource archive",
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
			source: "ArcFormats/Antique/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface AntiqueHeader {
	count: number;
	namesLength: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<AntiqueHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const namesLength = header.readUInt32LE(NAMES_LENGTH_OFFSET);
	const end = BigInt(INDEX_OFFSET + count * RECORD_SIZE + namesLength);
	if (end > source.size) return undefined;
	return { count, namesLength };
}

async function readAntiqueDat(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid An*tique ACHV signature");
	}
	const { count, namesLength } = header;
	const indexSize = count * RECORD_SIZE;
	const [index, names] = await Promise.all([
		source.readAt(BigInt(INDEX_OFFSET), indexSize),
		source.readAt(BigInt(INDEX_OFFSET + indexSize), namesLength),
	]);
	let namesPosition = 0;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		const nameEnd = names.indexOf(0, namesPosition);
		if (nameEnd === -1) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"An*tique ACHV names are truncated",
			);
		}
		const name = decodeCp932(names.subarray(namesPosition, nameEnd));
		namesPosition = nameEnd + 1;
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"An*tique ACHV entry has an empty name",
			);
		}
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`An*tique ACHV entry points outside the archive: ${name}`,
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

export const antiqueDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: antiqueDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAntiqueDat,
});
