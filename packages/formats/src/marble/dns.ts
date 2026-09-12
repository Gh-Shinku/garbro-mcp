// Format reference: GARbro ArcFormats/Marble/ArcDNS.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";
import { basename } from "node:path";
import { extname } from "node:path";

const FIRST_OFFSET_OFFSET = 8;
const FIRST_OFFSET = 0x8000;
const NAME_SIZE = 8;
const RECORD_SIZE = 0x10;
const MAXIMUM_ENTRIES = 0x800;

export const dnsDescriptor: FormatDescriptor = {
	id: "marble-dns",
	name: "DarkNiteSystem resource archive",
	extensions: [],
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
			source: "ArcFormats/Marble/ArcDNS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const dnsEntryOpener: FixedEntryOpener = async (source, entry) => {
	const data = Buffer.from(
		await source.readAt(entry.offset, Number(entry.size)),
	);
	for (let position = 0; position < data.length; position += 1) {
		data[position] = (0x100 - (data[position] ?? 0)) & 0xff;
	}
	return Readable.from([data]);
};

async function parseHeader(
	source: ByteSource,
	sourcePath: string,
): Promise<boolean> {
	if (basename(sourcePath).toLowerCase() !== "data.dns") return false;
	if (source.size < BigInt(FIRST_OFFSET)) return false;
	const header = await source.readAt(0n, FIRST_OFFSET_OFFSET + 4);
	return header.readUInt32LE(FIRST_OFFSET_OFFSET) === FIRST_OFFSET;
}

async function readDns(
	source: ByteSource,
	sourcePath: string,
): Promise<{ entries: FixedEntry[]; metadata: Record<string, unknown> }> {
	if (!(await parseHeader(source, sourcePath))) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid DarkNiteSystem DNS layout",
		);
	}
	const index = await source.readAt(0n, FIRST_OFFSET);
	const entries: FixedEntry[] = [];
	for (let position = 0; position < FIRST_OFFSET; position += RECORD_SIZE) {
		if (entries.length >= MAXIMUM_ENTRIES) break;
		const first = index[position] ?? 0;
		if (first === 0) break;
		const nameField = index.subarray(position, position + NAME_SIZE);
		const terminator = nameField.indexOf(0);
		const baseName = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (baseName.length === 0) break;
		const offset = BigInt(index.readUInt32LE(position + 8));
		const size = BigInt(index.readUInt32LE(position + 12));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`DarkNiteSystem DNS entry points outside the archive: ${baseName}`,
			);
		}
		const path = `${baseName.slice(0, baseName.length - extname(baseName).length)}.S`;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(path),
				offset,
				size,
				metadata: { type: "script" },
			}),
		);
	}
	if (entries.length === 0) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"DarkNiteSystem DNS archive is empty",
		);
	}
	return { entries, metadata: { entryCount: entries.length } };
}

export const dnsFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dnsDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return parseHeader(source, sourcePath);
	},
	read: readDns,
	openEntry: dnsEntryOpener,
});
