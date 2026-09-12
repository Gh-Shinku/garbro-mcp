// Format reference: GARbro ArcFormats/Irrlicht/ArcPACK.cs
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
	decodeCStringField,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const NAME_SIZE = 0x104;
const SIZE_OFFSET = 0x105;
const HEADER_SIZE = 0x10a;

export const irrlichtPackDescriptor: FormatDescriptor = {
	id: "irrlicht-pack",
	name: "Irrlicht engine audio archive",
	extensions: ["pack"],
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
			source: "ArcFormats/Irrlicht/ArcPACK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (sourceExtension(sourcePath) !== "pack") return false;
	if (source.size <= BigInt(HEADER_SIZE)) return false;
	const header = await source.readAt(0n, HEADER_SIZE);
	return decodeCStringField(header, 0, NAME_SIZE).trim().length > 0;
}

async function readIrrlichtPack(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Irrlicht PACK layout");
	}
	const entries: FixedEntry[] = [];
	let offset = 0n;
	while (offset < source.size) {
		if (offset + BigInt(HEADER_SIZE) >= source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Irrlicht PACK header is truncated",
			);
		}
		const header = await source.readAt(offset, HEADER_SIZE);
		const name = decodeCStringField(header, 0, NAME_SIZE);
		if (name.trim().length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Irrlicht PACK entry has an empty name",
			);
		}
		const size = BigInt(header.readUInt32LE(SIZE_OFFSET));
		const dataOffset = offset + BigInt(HEADER_SIZE);
		if (dataOffset + size > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Irrlicht PACK entry points outside the archive: ${name}`,
			);
		}
		if (!checkPlacement(dataOffset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Irrlicht PACK entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset: dataOffset,
				size,
			}),
		);
		offset = dataOffset + size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Irrlicht PACK archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const irrlichtPackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: irrlichtPackDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readIrrlichtPack,
});
