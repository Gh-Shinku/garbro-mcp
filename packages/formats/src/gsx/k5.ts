// Format reference: GARbro Legacy/Gsx/ArcK5.cs
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

const SIGNATURE = Buffer.from([0x4b, 0x35, 0x01, 0x00]);
const COUNT_OFFSET = 4;
const INDEX_POINTER_OFFSET = 8;
const DIR_NAME_SIZE = 0x80;
const NAME_SIZE = 0x40;
const OFFSET_OFFSET = 0xc8;
const SIZE_OFFSET = 0xcc;
const RECORD_SIZE = 0x100;

export const k5Descriptor: FormatDescriptor = {
	id: "gsx-k5",
	name: "GSX engine resource archive",
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
			source: "Legacy/Gsx/ArcK5.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function decodeUtf16Field(field: Buffer): string {
	let end = field.length;
	for (let index = 0; index + 1 < field.length; index += 2) {
		if (field[index] === 0 && field[index + 1] === 0) {
			end = index;
			break;
		}
	}
	return field.subarray(0, end).toString("utf16le");
}

interface K5Header {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<K5Header | undefined> {
	if (source.size < 12n) return undefined;
	const header = await source.readAt(0n, 12);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset };
}

async function readK5(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid GSX K5 layout");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const directory = decodeUtf16Field(
			index.subarray(recordOffset, recordOffset + DIR_NAME_SIZE),
		);
		const name = decodeUtf16Field(
			index.subarray(
				recordOffset + DIR_NAME_SIZE,
				recordOffset + DIR_NAME_SIZE + NAME_SIZE,
			),
		);
		const path = directory ? `${directory}\\${name}` : name;
		if (path.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"GSX K5 entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`GSX K5 entry points outside the archive: ${path}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(path),
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count } };
}

export const k5Format: ArchiveFormat = defineFixedArchive({
	descriptor: k5Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readK5,
});
