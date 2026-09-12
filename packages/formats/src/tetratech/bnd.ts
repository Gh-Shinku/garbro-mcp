// Format reference: GARbro Legacy/Tetratech/ArcBND.cs
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

const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;

export const bndDescriptor: FormatDescriptor = {
	id: "tetratech-bnd",
	name: "Tetratech resource archive",
	extensions: ["bnd"],
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
			source: "Legacy/Tetratech/ArcBND.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "bnd") return undefined;
	const index = await readCompanionFile(
		sourcePath,
		changeExtension(sourcePath, "idx"),
	);
	if (!index || index.length === 0) return undefined;
	if (index.length % RECORD_SIZE !== 0) return undefined;
	const count = index.length / RECORD_SIZE;
	if (!isSaneCount(count)) return undefined;
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const name = decodeCStringField(index, recordOffset, NAME_SIZE);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Tetratech BND entry has an empty name",
			);
		}
		const size = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE));
		const offset = BigInt(index.readUInt32LE(recordOffset + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Tetratech BND entry points outside the archive: ${name}`,
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

export const bndFormat: ArchiveFormat = defineFixedArchive({
	descriptor: bndDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "bnd") return false;
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Tetratech BND layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
