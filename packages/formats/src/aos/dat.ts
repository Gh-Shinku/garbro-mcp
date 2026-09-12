// Format reference: GARbro Legacy/Aos/ArcDAT.cs
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
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { readCompanionFile } from "../shared/companion.js";
import { decodeCp932 } from "@garbro-mcp/core";

const NAME_SIZE = 0x34;

export const aosDatDescriptor: FormatDescriptor = {
	id: "aos-dat",
	name: "AOS engine resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Aos/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== "dat") return undefined;
	const index = await readCompanionFile(sourcePath, "index.idx");
	if (!index) return undefined;
	const entries: FixedEntry[] = [];
	let position = 0;
	while (position < index.length) {
		const field = index.subarray(position, position + NAME_SIZE);
		const terminator = field.indexOf(0);
		if (terminator === -1 && field.length < NAME_SIZE) break;
		const name =
			terminator === -1
				? decodeCp932(field)
				: decodeCp932(field.subarray(0, terminator));
		position += terminator === -1 ? NAME_SIZE : terminator + 1;
		if (name.length === 0) break;
		if (position + 8 > index.length) {
			throw new GarbroError("INVALID_ARCHIVE", "AOS index is truncated");
		}
		const offset = BigInt(index.readUInt32LE(position));
		const size = BigInt(index.readUInt32LE(position + 4));
		position += 8;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`AOS entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

export const aosDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: aosDatDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== "dat") return false;
		try {
			return (await readIndex(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readIndex(source, sourcePath);
		if (!entries) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AOS DAT layout");
		}
		return { entries, metadata: { entryCount: entries.length } };
	},
});
