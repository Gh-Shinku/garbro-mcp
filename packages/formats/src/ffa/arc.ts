// Format reference: GARbro ArcFormats/Ffa/ArcFFA.cs
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = [
	Buffer.from("M2TYPE_WAV", "ascii"),
	Buffer.from("M2T_BMP", "ascii"),
	Buffer.from("M2T_WORD", "ascii"),
];
const INDEX_TAIL = 0x14;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;
const MAXIMUM_COUNT = 0xfffff;

export const ffaDescriptor: FormatDescriptor = {
	id: "ffa-arc",
	name: "FFA System resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Ffa/ArcFFA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface FfaHeader {
	count: number;
	indexOffset: bigint;
	indexSize: number;
}

async function parseHeader(source: ByteSource): Promise<FfaHeader | undefined> {
	if (source.size < BigInt(INDEX_TAIL)) return undefined;
	const head = await source.readAt(0n, 16);
	if (
		!SIGNATURES.some((signature) =>
			head.subarray(0, signature.length).equals(signature),
		)
	)
		return undefined;
	const tail = await source.readAt(
		source.size - BigInt(INDEX_TAIL),
		INDEX_TAIL,
	);
	const indexSize = tail.readUInt32LE(INDEX_TAIL - 12);
	const count = tail.readInt32LE(INDEX_TAIL - 8);
	if (count <= 0 || count > MAXIMUM_COUNT) return undefined;
	const indexOffset = source.size - BigInt(INDEX_TAIL) - BigInt(indexSize);
	if (indexOffset <= 0n) return undefined;
	if (indexOffset + BigInt(count * RECORD_SIZE) > source.size) return undefined;
	return { count, indexOffset, indexSize };
}

async function readFfa(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const header = await parseHeader(source);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid FFA ARC layout");
	}
	const { count, indexOffset, indexSize } = header;
	const index = await source.readAt(indexOffset, indexSize);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(recordOffset, recordOffset + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"FFA ARC entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const size = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`FFA ARC entry points outside the archive: ${name}`,
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

export const ffaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ffaDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readFfa,
});
