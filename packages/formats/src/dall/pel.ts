// Format reference: GARbro Legacy/Dall/ArcPEL.cs
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
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 2;
const NAME_SIZE = 0x14;

export const dallPelDescriptor: FormatDescriptor = {
	id: "dall-pel",
	name: "Dall resource archive",
	extensions: ["pel"],
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
			source: "Legacy/Dall/ArcPEL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<number | undefined> {
	if (sourceExtension(sourcePath) !== "pel") return undefined;
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	const count = header.readUInt16LE(0);
	return isSaneCount(count) ? count : undefined;
}

async function readDallPel(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	const count = await parseHeader(source, sourcePath);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Dall PEL layout");
	}
	const entries: FixedEntry[] = [];
	let position = BigInt(HEADER_SIZE);
	for (let id = 0; id < count; id += 1) {
		const available = Number(source.size - position);
		if (available <= 0) {
			throw new GarbroError("INVALID_ARCHIVE", "Dall PEL index is truncated");
		}
		const fieldLength = Math.min(NAME_SIZE, available);
		const nameField = await source.readAt(position, fieldLength);
		const terminator = nameField.indexOf(0);
		const nameEnd = terminator === -1 ? fieldLength : terminator + 1;
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Dall PEL entry has an empty name",
			);
		}
		position += BigInt(nameEnd);
		if (position + 4n > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Dall PEL index is truncated");
		}
		const size = BigInt((await source.readAt(position, 4)).readUInt32LE(0));
		position += 4n;
		if (!checkPlacement(position, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Dall PEL entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset: position,
				size,
			}),
		);
		position += size;
	}
	return { entries, metadata: { entryCount: count } };
}

export const dallPelFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dallPelDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await parseHeader(source, sourcePath)) !== undefined;
	},
	read: readDallPel,
});
