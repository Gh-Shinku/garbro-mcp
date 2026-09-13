// Format reference: GARBro ArcFormats/Hexenhaus/ArcARCC.cs
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("ARCC", "ascii");
const COUNT_OFFSET = 0x14;
const NAME_CHUNK_OFFSET = 0x2a;
const NAME_CHUNK_SIZE = 0x0e;
const NIDX_MARKER = Buffer.from("NIDX", "ascii");
const EIDX_MARKER = Buffer.from("EIDX", "ascii");
const CINF_MARKER = Buffer.from("CINF", "ascii");
const ADDR_MARKER = Buffer.from("ADDR", "ascii");
const FILE_MARKER = Buffer.from("FILE", "ascii");
const NIDX_RECORD_SIZE = 8;
const EIDX_RECORD_SIZE = 8;
const ADDR_RECORD_SIZE = 12;
const CINF_FIELDS_SIZE = 12;
const NAME_LENGTH_OFFSET = 6;
const NAME_OFFSET = 10;
const NAME_KEY = 0x69;
const FILE_SIZE_OFFSET = 0x18;
const FILE_HEADER_SIZE = 0x22;

export const arccDescriptor: FormatDescriptor = {
	id: "hexenhaus-arcc",
	name: "Hexenhaus resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Hexenhaus/ArcARCC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `ArcOpener.TryOpen`. The archive is a chain of chunks: `NAME` carries a 64-bit address that
 * points at the `ADDR` chunk, `NIDX` holds name offsets, `EIDX` is skipped, and `CINF` holds the
 * names, 0x69-XORed, in `12 + name length` byte records.
 *
 * The `ADDR` chunk stores one 64-bit offset per record. Only payloads that start with `FILE` count:
 * their size lives at +0x18 and the data itself starts behind the 0x22-byte header. Entries without
 * that marker, or with a zero size, are dropped.
 */
async function readArccIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(NAME_CHUNK_OFFSET + NAME_CHUNK_SIZE))
		return undefined;
	const header = await source.readAt(0n, COUNT_OFFSET + 4);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const nameChunk = await source.readAt(
		BigInt(NAME_CHUNK_OFFSET),
		NAME_CHUNK_SIZE,
	);
	if (!nameChunk.subarray(0, 4).equals(Buffer.from("NAME", "ascii")))
		return undefined;
	const addrOffset = nameChunk.readBigInt64LE(4);

	let position = BigInt(NAME_CHUNK_OFFSET + NAME_CHUNK_SIZE);
	const nidxSize = count * NIDX_RECORD_SIZE;
	if (position + BigInt(nidxSize + 4) > source.size) return undefined;
	const nidx = await source.readAt(position, 4);
	if (!nidx.equals(NIDX_MARKER)) return undefined;
	position += BigInt(4 + nidxSize);
	if (position + BigInt(count * EIDX_RECORD_SIZE + 4) > source.size)
		return undefined;
	const eidx = await source.readAt(position, 4);
	if (!eidx.equals(EIDX_MARKER)) return undefined;
	position += BigInt(4 + count * EIDX_RECORD_SIZE);
	if (position + 4n > source.size) return undefined;
	const cinf = await source.readAt(position, 4);
	if (!cinf.equals(CINF_MARKER)) return undefined;
	position += 4n;

	const names: string[] = [];
	for (let id = 0; id < count; id += 1) {
		if (position + BigInt(CINF_FIELDS_SIZE) > source.size) return undefined;
		const fields = await source.readAt(position, CINF_FIELDS_SIZE);
		const nameLength = fields.readUInt16LE(NAME_LENGTH_OFFSET);
		if (position + BigInt(CINF_FIELDS_SIZE + nameLength) > source.size)
			return undefined;
		const nameField = Buffer.from(
			await source.readAt(position + BigInt(NAME_OFFSET), nameLength),
		);
		for (let index = 0; index < nameField.length; index += 1)
			nameField[index] = (nameField[index] ?? 0) ^ NAME_KEY;
		names.push(decodeCp932(nameField));
		position += BigInt(CINF_FIELDS_SIZE + nameLength);
	}

	if (addrOffset < 0n || addrOffset + 4n > source.size) return undefined;
	const addrHeader = await source.readAt(addrOffset, 4);
	if (!addrHeader.equals(ADDR_MARKER)) return undefined;
	const addrSize = count * ADDR_RECORD_SIZE;
	if (addrOffset + 4n + BigInt(addrSize) > source.size) return undefined;
	const addr = await source.readAt(addrOffset + 4n, addrSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * ADDR_RECORD_SIZE;
		const recordOffset = addr.readBigInt64LE(record + 2);
		if (
			recordOffset < 0n ||
			recordOffset + BigInt(FILE_SIZE_OFFSET + 4) > source.size
		)
			continue;
		const marker = await source.readAt(recordOffset, FILE_MARKER.length);
		if (!marker.equals(FILE_MARKER)) continue;
		const size = BigInt(
			(
				await source.readAt(recordOffset + BigInt(FILE_SIZE_OFFSET), 4)
			).readUInt32LE(0),
		);
		if (size === 0n) continue;
		const offset = recordOffset + BigInt(FILE_HEADER_SIZE);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(names[id] ?? ""),
				offset,
				size,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const arccFormat: ArchiveFormat = defineFixedArchive({
	descriptor: arccDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readArccIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readArccIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Hexenhaus ARCC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
