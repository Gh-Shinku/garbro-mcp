// Format reference: GARbro ArcFormats/BlueGale/ArcSNN.cs
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
import { changeExtension, readCompanionFile } from "../shared/companion.js";

const COUNT_OFFSET = 0;
const INDEX_OFFSET = 4;
const NAME_SIZE = 0x40;
const RECORD_SIZE = 0x48;
const OFFSET_OFFSET = 0x40;
const SIZE_OFFSET = 0x44;

export const snnDescriptor: FormatDescriptor = {
	id: "blue-gale-snn",
	name: "BlueGale resource archive",
	extensions: ["snn"],
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
			source: "ArcFormats/BlueGale/ArcSNN.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "snn") return undefined;
	const index = await readCompanionFile(
		sourcePath,
		changeExtension(sourcePath, "Inx"),
	);
	if (!index || index.length < INDEX_OFFSET) return undefined;
	const count = index.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > BigInt(index.length))
		return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = INDEX_OFFSET + id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"BlueGale SNN entry has an empty name",
			);
		const offset = BigInt(index.readUInt32LE(recordOffset + OFFSET_OFFSET));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`BlueGale SNN entry points outside the archive: ${name}`,
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
	return entries;
}

export const snnFormat: ArchiveFormat = defineFixedArchive({
	descriptor: snnDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "snn") return false;
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid BlueGale SNN layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
