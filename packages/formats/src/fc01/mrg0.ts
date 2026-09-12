// Format reference: GARbro ArcFormats/FC01/ArcMRG0.cs
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

const MRG0_SIGNATURE = Buffer.from("mrg0", "ascii");
const HEADER_SIZE = 0x10;
const NAME_SIZE = 0x40;
const RECORD_SIZE = 0x4c;
const SIZE_OFFSET = 0x40;

export const mrg0Descriptor: FormatDescriptor = {
	id: "fc01-mrg0",
	name: "F&C Co. engine resource archive",
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
			source: "ArcFormats/FC01/ArcMRG0.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface Mrg0Header {
	count: number;
	dataOffset: bigint;
}

function parseHeader(header: Buffer): Mrg0Header | undefined {
	if (!header.subarray(0, MRG0_SIGNATURE.length).equals(MRG0_SIGNATURE))
		return undefined;
	const count = header.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;
	return { count, dataOffset: BigInt(header.readUInt32LE(8)) };
}

async function readMrg0(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await source.readAt(0n, HEADER_SIZE);
	const parsed = parseHeader(header);
	if (!parsed) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid F&C MRG0 archive signature",
		);
	}
	const { count, dataOffset } = parsed;
	const indexSize = count * RECORD_SIZE;
	if (
		BigInt(HEADER_SIZE + indexSize) > source.size ||
		dataOffset >= source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "F&C MRG0 index is truncated");
	}
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const entries: FixedEntry[] = [];
	let offset = dataOffset;
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"F&C MRG0 entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`F&C MRG0 entry points outside the archive: ${name}`,
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
		offset += size;
	}
	return { entries, metadata: { entryCount: count } };
}

export const mrg0Format: ArchiveFormat = defineFixedArchive({
	descriptor: mrg0Descriptor,
	detection: { signatures: [{ bytes: MRG0_SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const parsed = parseHeader(header);
		if (!parsed) return false;
		return (
			BigInt(HEADER_SIZE + parsed.count * RECORD_SIZE) <= source.size &&
			parsed.dataOffset < source.size
		);
	},
	read: readMrg0,
});
