// Format reference: GARbro ArcFormats/Hexenhaus/ArcWAG.cs, class `WagOpener` and `Ror4EncryptedStream`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("IAF_", "ascii");
const COUNT_FIELD = 6;
/** The index starts behind the header, which stays in plain text. */
const INDEX_OFFSET = 0x4a;
const DATA_MARKER = Buffer.from("DATA", "ascii");
const IMGD_MARKER = Buffer.from("IMGD", "ascii");
const FNNE_MARKER = Buffer.from("FNNE", "ascii");
/** An IMGD entry is reported six bytes longer than its own section. */
const IMGD_SIZE_BIAS = 0x10;
/** Sections are followed by two bytes that are not part of their size. */
const SECTION_PADDING = 2;
const SECTION_COUNT_FIELDS = 6;
const SECTION_HEADER_SIZE = 8;

/** `Binary.RotByteR (value, 4)`, a nibble swap that is its own inverse. */
function rotateByte(value: number): number {
	return ((value >> 4) | (value << 4)) & 0xff;
}

function decrypt(bytes: Buffer): Buffer {
	const output = Buffer.from(bytes);
	for (let index = 0; index < output.length; index += 1)
		output[index] = rotateByte(output[index] ?? 0);
	return output;
}

/** Reads a plain text range of the decrypted stream. */
async function readDecrypted(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || length < 0) return undefined;
	if (BigInt(offset) + BigInt(length) > source.size) return undefined;
	return decrypt(Buffer.from(await source.readAt(BigInt(offset), length)));
}

function readName(bytes: Buffer): string {
	const end = bytes.indexOf(0);
	return decodeCp932(end === -1 ? bytes : bytes.subarray(0, end));
}

/**
 * GARbro `WagOpener.TryOpen`. The header carries only a count; the real index is a table of offsets at
 * 0x4A, each pointing at a `DATA` record whose sections are `FNNE` (the name) and `IMGD` (the payload).
 * Every byte read through the index is rotated right by four bits, which the port applies to the ranges
 * it reads rather than to a whole stream.
 */
async function readWagIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = Buffer.from(await source.readAt(0n, INDEX_OFFSET));
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const table = await readDecrypted(source, INDEX_OFFSET, count * 4);
	if (!table) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = table.readUInt32LE(id * 4);
		const position = await readDecrypted(
			source,
			recordOffset,
			DATA_MARKER.length,
		);
		if (!position?.equals(DATA_MARKER)) continue;
		const fields = await readDecrypted(
			source,
			recordOffset + DATA_MARKER.length,
			SECTION_COUNT_FIELDS,
		);
		if (!fields) return undefined;
		const sectionCount = fields.readInt32LE(0);
		if (sectionCount < 0) return undefined;
		let cursor = recordOffset + DATA_MARKER.length + SECTION_COUNT_FIELDS;
		let offset: bigint | undefined;
		let size = 0n;
		let name: string | undefined;
		for (let section = 0; section < sectionCount; section += 1) {
			const marker = await readDecrypted(source, cursor, SECTION_HEADER_SIZE);
			if (!marker) return undefined;
			const sectionSize = marker.readUInt32LE(4);
			if (marker.subarray(0, 4).equals(IMGD_MARKER)) {
				offset = BigInt(cursor);
				size = BigInt(sectionSize) + BigInt(IMGD_SIZE_BIAS);
				if (!checkPlacement(offset, size, source.size)) return undefined;
				cursor += SECTION_HEADER_SIZE + sectionSize + SECTION_PADDING;
				continue;
			}
			if (marker.subarray(0, 4).equals(FNNE_MARKER)) {
				const nameLength = sectionSize - 2;
				if (nameLength < 0) return undefined;
				const field = await readDecrypted(
					source,
					cursor + SECTION_HEADER_SIZE + 2,
					nameLength,
				);
				if (!field) return undefined;
				name = readName(field);
				cursor += SECTION_HEADER_SIZE + 2 + nameLength + SECTION_PADDING;
				continue;
			}
			cursor += SECTION_HEADER_SIZE + sectionSize + SECTION_PADDING;
		}
		if (offset === undefined || size === 0n || !name) continue;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const wagDescriptor: FormatDescriptor = {
	id: "hexenhaus-wag",
	name: "Hexenhaus resource archive",
	extensions: ["wag"],
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
			source: "ArcFormats/Hexenhaus/ArcWAG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const wagFormat: ArchiveFormat = defineFixedArchive({
	descriptor: wagDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readWagIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readWagIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hexenhaus WAG layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	/** `WagOpener.OpenEntry` reads the stored region and rotates it back, like every index read does. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = await source.readAt(entry.offset, Number(entry.size));
		return Readable.from([decrypt(Buffer.from(stored))]);
	},
});
