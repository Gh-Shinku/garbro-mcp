// Format reference: GARBro ArcFormats/Tactics/ArcYU.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { readCompanionFile } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const COMPANION_SUFFIX = ".dll";
const NAME_SIZE = 0x41;
const RECORD_TAIL_SIZE = 5;
const KEY = 0x55;
/** Content type whose payload is XOR-obfuscated. */
const ENCRYPTED_TYPE = 3;

export const yuDescriptor: FormatDescriptor = {
	id: "tactics-yu",
	name: "Tactics resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Tactics/ArcYU.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `YuOpener.TryOpen`. The index lives in a companion file whose name is the archive name plus
 * `.dll`. Records hold a 0x41-byte name field whose bytes are XORed with 0x55 up to the first NUL,
 * followed by the data offset and a content-type byte.
 *
 * Records carry no sizes, so GARbro derives each size from the next offset and lets the last entry
 * run to the end of the archive. Type 3 payloads are XORed with the same key on extraction.
 */
async function readYuIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	const companion = await readCompanionFile(
		sourcePath,
		`${basename(sourcePath)}${COMPANION_SUFFIX}`,
	);
	if (!companion) return undefined;
	const offsets: { offset: bigint; type: number }[] = [];
	const names: string[] = [];
	let position = 0;
	while (position + NAME_SIZE + RECORD_TAIL_SIZE <= companion.length) {
		const field = Buffer.from(
			companion.subarray(position, position + NAME_SIZE),
		);
		const terminator = field.indexOf(0);
		const nameEnd = terminator === -1 ? NAME_SIZE : terminator;
		for (let index = 0; index < nameEnd; index += 1)
			field[index] = (field[index] ?? 0) ^ KEY;
		names.push(decodeCp932(field.subarray(0, nameEnd)));
		const offset = BigInt(companion.readUInt32LE(position + NAME_SIZE));
		if (offset > source.size) return undefined;
		const type = companion[position + NAME_SIZE + 4] ?? 0;
		offsets.push({ offset, type });
		position += NAME_SIZE + RECORD_TAIL_SIZE;
	}
	if (offsets.length === 0) return undefined;

	const entries: FixedEntry[] = [];
	for (const [id, record] of offsets.entries()) {
		const next = offsets[id + 1]?.offset ?? source.size;
		const size = next - record.offset;
		if (size < 0n || !checkPlacement(record.offset, size, source.size))
			return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(names[id] ?? ""),
			offset: record.offset,
			size,
			encrypted: record.type === ENCRYPTED_TYPE,
		});
		entry.metadata = { contentType: record.type };
		entries.push(entry);
	}
	return entries;
}

/** GARbro `YuOpener.OpenEntry`: type 3 payloads are XORed with 0x55. */
const yuEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	if (entry.metadata?.contentType !== ENCRYPTED_TYPE)
		return Readable.from([payload]);
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = (payload[position] ?? 0) ^ KEY;
	return Readable.from([payload]);
};

export const yuFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yuDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readYuIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readYuIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Tactics layout or missing companion index",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: yuEntryOpener,
});
