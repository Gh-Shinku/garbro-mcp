// Format reference: GARbro Legacy/ApplePie/ArcARC.cs
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
	decodeCStringField,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from([0x41, 0x52, 0x43, 0x10]);
const COUNT_OFFSET = 4;
const INDEX_POINTER_OFFSET = 0x0c;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;
const SIZE_OFFSET = 0x10;
const OFFSET_OFFSET = 0x14;

export const applePieArcDescriptor: FormatDescriptor = {
	id: "applepie-arc",
	name: "Apple Pie resource archive",
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
			source: "Legacy/ApplePie/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface ApplePieHeader {
	count: number;
	indexOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
): Promise<ApplePieHeader | undefined> {
	if (source.size < 0x10n) return undefined;
	const header = await source.readAt(0n, 0x10);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_POINTER_OFFSET));
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset };
}

async function readApplePieArc(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Apple Pie ARC layout");
	}
	const { count, indexOffset } = header;
	const index = await source.readAt(indexOffset, count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Apple Pie ARC entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Apple Pie ARC entry points outside the archive: ${name}`,
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

export const applePieArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: applePieArcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readApplePieArc,
});
