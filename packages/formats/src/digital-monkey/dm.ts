// Format reference: GARBro Legacy/DigitalMonkey/ArcDM.cs, class `DmOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
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

const EXTENSION = "dm";
const INDEX_OFFSET = 4;
const RECORD_SIZE = 0x2c;
const NAME_SIZE = 0x20;
const UNPACKED_SIZE_FIELD = 0x20;
const STORED_SIZE_FIELD = 0x24;
const OFFSET_FIELD = 0x28;

export const dmDescriptor: FormatDescriptor = {
	id: "digital-monkey-dm",
	name: "Digital Monkey resource archive",
	extensions: [EXTENSION],
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
			source: "Legacy/DigitalMonkey/ArcDM.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function archiveType(sourcePath: string): string | undefined {
	const name = basename(sourcePath)
		.replace(/\.[^.]*$/, "")
		.toLowerCase();
	if (name === "image") return "image";
	if (name === "sound") return "audio";
	return undefined;
}

async function readDmIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION || source.size < 4n)
		return undefined;
	const count = (await source.readAt(0n, 4)).readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	if (BigInt(dataOffset) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const type = archiveType(sourcePath);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.trim().length === 0) return undefined;
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const storedSize = BigInt(index.readUInt32LE(record + STORED_SIZE_FIELD));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (
			offset < BigInt(dataOffset) ||
			!checkPlacement(offset, storedSize, source.size)
		)
			return undefined;
		const entry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: unpackedSize,
			packedSize: storedSize,
			compressed: true,
			...(type === undefined ? {} : { metadata: { inferredType: type } }),
		});
		entry.sizeKnown = false;
		entries.push(entry);
	}
	return entries;
}

async function openDmEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	return createZlibInflateStream(
		source.createReadStream(entry.offset, entry.packedSize),
	);
}

export const dmFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dmDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readDmIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readDmIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Digital Monkey DM layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openDmEntry,
});
