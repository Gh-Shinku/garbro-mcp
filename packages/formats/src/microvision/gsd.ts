// Format reference: GARbro ArcFormats/MicroVision/ArcGSD.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("GSD\0", "binary");
const COUNT_OFFSET = 0x1c;
const BASE_OFFSET_OFFSET = 8;
const INDEX_OFFSET = 0x34;
const RECORD_SIZE = 0x20;
const MAXIMUM_COUNT = 0x40000;

export const gsdDescriptor: FormatDescriptor = {
	id: "microvision-gsd",
	name: "MicroVision audio resource archive",
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
			source: "ArcFormats/MicroVision/ArcGSD.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface GsdHeader {
	count: number;
	baseOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<GsdHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count) || count >= MAXIMUM_COUNT) return undefined;
	return { count, baseOffset: BigInt(header.readUInt32LE(BASE_OFFSET_OFFSET)) };
}

async function readGsd(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const parsed = await parseHeader(source);
	if (!parsed) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid MicroVision GSD signature",
		);
	}
	const { count, baseOffset } = parsed;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"MicroVision GSD index is truncated",
		);
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const offset = baseOffset + BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"MicroVision GSD entry points outside the archive",
			);
		}
		entries.push(
			createFixedEntry({
				id,
				path: `${id.toString().padStart(5, "0")}.wav`,
				offset,
				size,
			}),
		);
	}
	return { entries, metadata: { entryCount: count, baseOffset } };
}

export const gsdFormat: ArchiveFormat = defineFixedArchive({
	descriptor: gsdDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		const parsed = await parseHeader(source);
		if (!parsed) return false;
		return BigInt(INDEX_OFFSET + parsed.count * RECORD_SIZE) <= source.size;
	},
	read: readGsd,
});
