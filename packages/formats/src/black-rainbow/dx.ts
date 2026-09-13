// Format reference: GARBro ArcFormats/BlackRainbow/ArcDX.cs
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
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PACK", "ascii");
const EXTENSION = "pak";
const INDEX_LENGTH_OFFSET = 4;
const ROOT_OFFSET = 8;
const NAME_SIZE = 0x20;
const DIR_RECORD_SIZE = 0x28;
const FILE_RECORD_SIZE = 0x28;
const SIZE_OFFSET = NAME_SIZE + 4;
/** Guard against archives whose directory records form a cycle. */
const MAX_DEPTH = 64;
const INVERTED_EXTENSION = "hse";

export const dxDescriptor: FormatDescriptor = {
	id: "black-rainbow-dx",
	name: "DX engine resource archive",
	extensions: ["pak"],
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
			source: "ArcFormats/BlackRainbow/ArcDX.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface DxRecord {
	path: string;
	offset: bigint;
	size: bigint;
	inverted: boolean;
}

function readName(index: Buffer, offset: number): string | undefined {
	if (offset + NAME_SIZE > index.length) return undefined;
	const field = index.subarray(offset, offset + NAME_SIZE);
	const terminator = field.indexOf(0);
	return decodeCp932(terminator === -1 ? field : field.subarray(0, terminator));
}

/**
 * GARBro `IndexReader.ReadDir`: every directory record holds a name, the offset of a nested index,
 * and a base offset added to that directory's entries. Behind the directory records comes the file
 * count and that many `name, offset, size` triplets, where offsets are relative to the base offset of
 * the directory the file belongs to.
 */
function readDir(
	index: Buffer,
	root: string,
	dirOffset: number,
	baseOffset: bigint,
	maxOffset: bigint,
	depth: number,
): DxRecord[] | undefined {
	if (depth > MAX_DEPTH) return undefined;
	if (dirOffset + 4 > index.length) return undefined;
	const dirCount = index.readInt32LE(dirOffset);
	if (dirCount < 0) return undefined;
	let position = dirOffset + 4;
	const records: DxRecord[] = [];
	for (let id = 0; id < dirCount; id += 1) {
		if (position + DIR_RECORD_SIZE > index.length) return undefined;
		const name = readName(index, position);
		const offset = index.readUInt32LE(position + NAME_SIZE);
		const dataOffset = BigInt(index.readUInt32LE(position + NAME_SIZE + 4));
		if (
			name === undefined ||
			offset <= position ||
			offset > index.length ||
			dataOffset > maxOffset
		)
			return undefined;
		const nested = readDir(
			index,
			`${root}/${name}`,
			offset,
			baseOffset + dataOffset,
			maxOffset,
			depth + 1,
		);
		if (!nested) return undefined;
		records.push(...nested);
		position += DIR_RECORD_SIZE;
	}
	if (position + 4 > index.length) return undefined;
	const count = index.readInt32LE(position);
	position += 4;
	if (count === 0) return records;
	if (!isSaneCount(count)) return undefined;
	for (let id = 0; id < count; id += 1) {
		if (position + FILE_RECORD_SIZE > index.length) return undefined;
		const name = readName(index, position);
		if (name === undefined) return undefined;
		const offset =
			BigInt(index.readUInt32LE(position + NAME_SIZE)) + baseOffset;
		const size = BigInt(index.readUInt32LE(position + SIZE_OFFSET));
		if (!checkPlacement(offset, size, maxOffset)) return undefined;
		records.push({
			path: `${root}/${name}`.replace(/^\/+/, ""),
			offset,
			size,
			inverted: name.toLowerCase().endsWith(`.${INVERTED_EXTENSION}`),
		});
		position += FILE_RECORD_SIZE;
	}
	return records;
}

async function readDxIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(ROOT_OFFSET)) return undefined;
	const header = await source.readAt(0n, ROOT_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexLength = header.readUInt32LE(INDEX_LENGTH_OFFSET);
	if (BigInt(indexLength) >= source.size || indexLength < ROOT_OFFSET)
		return undefined;
	const index = await source.readAt(0n, indexLength);
	const records = readDir(
		index,
		"",
		ROOT_OFFSET,
		BigInt(indexLength),
		source.size,
		0,
	);
	if (!records || records.length === 0) return undefined;
	return records.map((record, id) => {
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(record.path),
			offset: record.offset,
			size: record.size,
			encrypted: record.inverted,
		});
		if (record.inverted) entry.metadata = { inverted: true };
		return entry;
	});
}

/** GARBro `PackOpener.OpenEntry`: `*.hse` payloads are stored bitwise inverted. */
const dxEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.metadata?.inverted !== true)
		return source.createReadStream(entry.offset, entry.size);
	const payload = await source.readAt(entry.offset, Number(entry.size));
	for (let position = 0; position < payload.length; position += 1)
		payload[position] = ~(payload[position] ?? 0) & 0xff;
	return Readable.from([payload]);
};

export const dxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: dxDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (sourceExtension(sourcePath) !== EXTENSION) return false;
		return (await readDxIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDxIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DX engine PACK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: dxEntryOpener,
});
