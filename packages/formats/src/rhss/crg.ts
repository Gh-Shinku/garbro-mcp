// Format reference: GARbro Legacy/Rhss/ArcCRG.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { inflateSync } from "node:zlib";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CRG\0", "binary");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 60;
const SIZE_OFFSET = 4;
const NAME_OFFSET = 8;
const NAME_SIZE = 0x30;
const PACKED_TAG = Buffer.from("CMP\0", "binary");
const PACKED_HEADER_SIZE = 0x50;

export const crgDescriptor: FormatDescriptor = {
	id: "rhss-crg",
	name: "RHSS engine resource archive",
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
			source: "Legacy/Rhss/ArcCRG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

const crgEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.size < BigInt(PACKED_HEADER_SIZE)) {
		return source.createReadStream(entry.offset, entry.size);
	}
	const header = await source.readAt(entry.offset, PACKED_HEADER_SIZE);
	if (!header.subarray(0, 4).equals(PACKED_TAG)) {
		return source.createReadStream(entry.offset, entry.size);
	}
	const compressed = await source.readAt(
		entry.offset + BigInt(PACKED_HEADER_SIZE),
		Number(entry.size - BigInt(PACKED_HEADER_SIZE)),
	);
	let output: Buffer;
	try {
		output = Buffer.from(inflateSync(compressed));
	} catch {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			`RHSS CRG entry has an invalid zlib stream: ${entry.path}`,
		);
	}
	for (let position = 0; position < output.length; position += 1) {
		output[position] = (output[position] ?? 0) ^ 0xff;
	}
	return Readable.from([output]);
};

async function parseHeader(source: ByteSource): Promise<number | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_OFFSET + count * RECORD_SIZE) > source.size)
		return undefined;
	return count;
}

async function readCrg(source: ByteSource): Promise<{
	entries: FixedEntry[];
	metadata: Record<string, unknown>;
}> {
	const count = await parseHeader(source);
	if (count === undefined) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid RHSS CRG signature");
	}
	const index = await source.readAt(BigInt(INDEX_OFFSET), count * RECORD_SIZE);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = id * RECORD_SIZE;
		const nameField = index.subarray(
			recordOffset + NAME_OFFSET,
			recordOffset + NAME_OFFSET + NAME_SIZE,
		);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		if (name.length === 0) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"RHSS CRG entry has an empty name",
			);
		}
		const offset = BigInt(index.readUInt32LE(recordOffset));
		const size = BigInt(index.readUInt32LE(recordOffset + SIZE_OFFSET));
		if (!checkPlacement(offset, size, source.size)) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`RHSS CRG entry points outside the archive: ${name}`,
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

export const crgFormat: ArchiveFormat = defineFixedArchive({
	descriptor: crgDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await parseHeader(source)) !== undefined;
	},
	read: readCrg,
	openEntry: crgEntryOpener,
});
