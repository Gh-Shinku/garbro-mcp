// Format reference: GARbro ArcFormats/OneUp/ArcARC.cs
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

const SIGNATURE = Buffer.from([0x00, 0x41, 0x52, 0x43]);
const INDEX_OFFSET = 0x0c;
const MAXIMUM_NAME_LENGTH = 0x400;

export const oneUpArcDescriptor: FormatDescriptor = {
	id: "oneup-arc",
	name: "One-up resource archive",
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
			source: "ArcFormats/OneUp/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface OneUpHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
): Promise<OneUpHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(4));
	const count = header.readInt32LE(8);
	if (dataOffset >= source.size || !isSaneCount(count)) return undefined;
	return { count, dataOffset };
}

async function readOneUpArc(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid One-up ARC signature");
	}
	let position = BigInt(INDEX_OFFSET);
	let dataOffset = header.dataOffset;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < header.count; id += 1) {
		if (position + 4n > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "One-up ARC index is truncated");
		}
		const nameLength = (await source.readAt(position, 4)).readUInt32LE(0);
		position += 4n;
		if (nameLength > MAXIMUM_NAME_LENGTH) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"One-up ARC entry name is too long",
			);
		}
		if (position + BigInt(nameLength) + 4n > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "One-up ARC index is truncated");
		}
		const nameBytes = await source.readAt(position, nameLength);
		const name = nameBytes.toString("utf16le");
		position += BigInt(nameLength);
		const size = BigInt((await source.readAt(position, 4)).readUInt32LE(0));
		position += 4n;
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"One-up ARC entry has an empty name",
			);
		}
		if (!checkPlacement(dataOffset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`One-up ARC entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
		dataOffset += size;
	}
	return { entries, metadata: { entryCount: header.count } };
}

export const oneUpArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: oneUpArcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readOneUpArc,
});
