// Format reference: GARbro Legacy/Clio/ArcPAC.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;
const SIZE_OFFSET = 0x20;
const OFFSET_OFFSET = 0x24;

export const clioPacDescriptor: FormatDescriptor = {
	id: "clio-pac",
	name: "Clio resource archive",
	extensions: ["pac"],
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
			source: "Legacy/Clio/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface ClioHeader {
	count: number;
	dataOffset: bigint;
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<ClioHeader | undefined> {
	if (sourceExtension(sourcePath) !== "pac") return undefined;
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const count = (await source.readAt(0n, INDEX_OFFSET)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET + count * RECORD_SIZE);
	if (dataOffset > source.size) return undefined;
	return { count, dataOffset };
}

async function readClioPac(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const header = await parseHeader(source, sourcePath);
	if (!header) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Clio PAC layout");
	}
	const { count, dataOffset } = header;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Clio PAC entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		if (offset < dataOffset || !checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Clio PAC entry points outside the archive: ${name}`,
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

export const clioPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: clioPacDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readClioPac,
});
