// Format reference: GARbro ArcFormats/Abel/ArcBIN.cs
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

const HEADER_SIZE = 0x18;
const INDEX_POSITION_OFFSET = 0x14;
const RECORD_SIZE = 12;

export const abelBinDescriptor: FormatDescriptor = {
	id: "abel-bin",
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
			source: "ArcFormats/Abel/ArcBIN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface AbelHeader {
	count: number;
	indexSize: number;
	indexPosition: number;
}

async function parseHeader(
	source: ByteSource,
): Promise<AbelHeader | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (BigInt(header.readUInt32LE(0)) !== source.size) return undefined;
	const count = header.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;
	const indexSize = header.readUInt32LE(8);
	const indexPosition = header.readInt32LE(INDEX_POSITION_OFFSET);
	if (
		indexSize === 0 ||
		indexSize >= source.size ||
		indexPosition < 0 ||
		BigInt(indexPosition) >= source.size
	)
		return undefined;
	return { count, indexSize, indexPosition };
}

async function readAbelBin(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Abel BIN layout");
	}
	const { count, indexSize } = header;
	const index = await source.readAt(0n, indexSize);
	let position = header.indexPosition;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		if (position + RECORD_SIZE > index.length) {
			throw new GarbroError("INVALID_ARCHIVE", "Abel BIN index is truncated");
		}
		const namePosition = index.readInt32LE(position);
		if (namePosition < 0 || namePosition >= index.length) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Abel BIN entry name offset is invalid",
			);
		}
		const nameEnd = index.indexOf(0, namePosition);
		const name = decodeCp932(
			index.subarray(namePosition, nameEnd === -1 ? index.length : nameEnd),
		).replace(/^[\\/]+/, "");
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Abel BIN entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(position + 4));
		const size = BigInt(index.readUInt32LE(position + 8));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Abel BIN entry points outside the archive: ${name}`,
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

export const abelBinFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abelBinDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readAbelBin,
});
