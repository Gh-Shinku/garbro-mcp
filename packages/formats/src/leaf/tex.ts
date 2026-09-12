// Format reference: GARbro ArcFormats/Leaf/ArcTEX.cs
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

const SIGNATURE = Buffer.from("TEX ", "ascii");
const SECOND_TAG = Buffer.from("PACK0.02", "ascii");
const COUNT_OFFSET = 12;
const INDEX_OFFSET = 0x20;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;

export const leafTexDescriptor: FormatDescriptor = {
	id: "leaf-tex",
	name: "Leaf textures archive",
	extensions: ["tex"],
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
			source: "ArcFormats/Leaf/ArcTEX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface TexHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(source: ByteSource): Promise<TexHeader | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!header.subarray(4, 4 + SECOND_TAG.length).equals(SECOND_TAG))
		return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	return { count, dataOffset: BigInt(INDEX_OFFSET + indexSize) };
}

async function readLeafTex(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Leaf TEX signature");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Leaf TEX entry has an empty name",
			);
		}
		const offset =
			dataOffset + BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Leaf TEX entry points outside the archive: ${name}`,
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

export const leafTexFormat: ArchiveFormat = defineFixedArchive({
	descriptor: leafTexDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readLeafTex,
});
