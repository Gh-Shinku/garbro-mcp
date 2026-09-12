// Format reference: GARbro ArcFormats/Hypatia/ArcLPK.cs
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
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const NAME_AREA_END = 0x200;
const OFFSET_TABLE = 0x2000;
const BASE_OFFSET = 0x2800;
const NAME_SIZE = 0x10;
const MAXIMUM_ENTRIES = 0x200;

export const lpkDescriptor: FormatDescriptor = {
	id: "kogado-lpk",
	name: "Kogado resource archive",
	extensions: ["lpk"],
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
			source: "ArcFormats/Hypatia/ArcLPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isValidEntryName(name: string): boolean {
	if (name.trim().length === 0) return false;
	return !name.startsWith("/") && !name.startsWith("\\") && !name.includes(":");
}

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<number | undefined> {
	if (sourceExtension(sourcePath) !== "lpk") return undefined;
	if (source.size < BigInt(BASE_OFFSET)) return undefined;
	const names = await source.readAt(0n, NAME_AREA_END);
	let count = 0;
	for (let index = 0; index < MAXIMUM_ENTRIES; index += 1) {
		const recordOffset = index * NAME_SIZE;
		const first = names[recordOffset] ?? 0;
		if (first === 0) break;
		const name = decodeCp932(
			names.subarray(recordOffset, recordOffset + NAME_SIZE),
		);
		const terminator = name.indexOf("\0");
		const value = terminator === -1 ? name : name.slice(0, terminator);
		if (!isValidEntryName(value)) return undefined;
		count += 1;
	}
	if (count === 0) return undefined;
	if (BigInt(OFFSET_TABLE + (count + 1) * 4) > source.size) return undefined;
	return count;
}

async function readLpk(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source, sourcePath);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Kogado LPK layout");
	}
	const names = await source.readAt(0n, NAME_AREA_END);
	const offsets = await source.readAt(BigInt(OFFSET_TABLE), (count + 1) * 4);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const nameField = names.subarray(id * NAME_SIZE, (id + 1) * NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		const offset = BigInt(offsets.readUInt32LE(id * 4)) + BigInt(BASE_OFFSET);
		const nextOffset =
			BigInt(offsets.readUInt32LE((id + 1) * 4)) + BigInt(BASE_OFFSET);
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Kogado LPK entry points outside the archive: ${name}`,
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

export const lpkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: lpkDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readLpk,
});
