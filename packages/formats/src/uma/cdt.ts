// Format reference: GARbro Legacy/Uma/ArcCDT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const NAME_SIZE = 0x10;
const EXTENSIONS = new Set(["cdt", "spt"]);

export const cdtDescriptor: FormatDescriptor = {
	id: "uma-cdt",
	name: "Uma resource archive",
	extensions: ["cdt", "spt"],
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
			source: "Legacy/Uma/ArcCDT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function isPacked(entry: FixedEntry): boolean {
	return entry.metadata?.packed === true;
}

const cdtEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!isPacked(entry))
		return source.createReadStream(entry.offset, entry.size);
	const compressed = await source.readAt(entry.offset, Number(entry.size));
	return Readable.from([inflateLzssAll(compressed)]);
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (!EXTENSIONS.has(sourceExtension(sourcePath))) return false;
	if (source.size < BigInt(NAME_SIZE + 12)) return false;
	const nameField = await source.readAt(0n, NAME_SIZE);
	const terminator = nameField.indexOf(0);
	return terminator > 0;
}

async function readCdt(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const entries: FixedEntry[] = [];
	let position = 0n;
	while (position < source.size) {
		if (position + BigInt(NAME_SIZE + 12) > source.size) {
			throw new GarbroError("INVALID_ARCHIVE", "Uma CDT index is truncated");
		}
		const nameField = await source.readAt(position, NAME_SIZE);
		const terminator = nameField.indexOf(0);
		if (terminator <= 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Uma CDT entry has an invalid name",
			);
		}
		const name = decodeCp932(nameField.subarray(0, terminator));
		position += BigInt(terminator + 1);
		const header = await source.readAt(position, 12);
		const unpackedSize = header.readUInt32LE(0);
		const size = BigInt(header.readUInt32LE(4));
		const packed = header.readInt32LE(8) !== 0;
		position += 12n;
		if (!checkPlacement(position, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Uma CDT entry points outside the archive: ${name}`,
			);
		}
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset: position,
				size,
				compressed: packed,
				metadata: { packed, unpackedSize: unpackedSize.toString() },
			}),
		);
		position += size;
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "Uma CDT archive is empty");
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const cdtFormat: ArchiveFormat = defineFixedArchive({
	descriptor: cdtDescriptor,
	detection: { extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readCdt,
	openEntry: cdtEntryOpener,
});
