// Format reference: GARBro ArcFormats/Noesis/ArcIGA.cs
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

const SIGNATURE = 0x30414749;
const INDEX_OFFSET = 0x10;
/** Payload transform: every byte is XORed with its position plus two. */
const XOR_KEY = 0xff;
const SCRIPT_EXTENSION = "s";

export const igaDescriptor: FormatDescriptor = {
	id: "noesis-iga",
	name: "Noesis resource archive",
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
			source: "ArcFormats/Noesis/ArcIGA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface IgaCursor {
	position: number;
}

/**
 * GARbro `ReadPackedUInt`: bytes accumulate seven bits at a time until the running value becomes odd,
 * and the final value is shifted right by one.
 */
function readPackedUInt(buffer: Buffer, cursor: IgaCursor): number | undefined {
	let value = 0;
	while ((value & 1) === 0) {
		if (cursor.position >= buffer.length) return undefined;
		value = ((value << 7) | (buffer[cursor.position] ?? 0)) >>> 0;
		cursor.position += 1;
	}
	return value >>> 1;
}

/** GARbro `ReadPackedString`: one packed integer per CP932 character. */
function readPackedString(
	buffer: Buffer,
	cursor: IgaCursor,
	length: number,
): string | undefined {
	const bytes = Buffer.alloc(length);
	for (let index = 0; index < length; index += 1) {
		const value = readPackedUInt(buffer, cursor);
		if (value === undefined) return undefined;
		bytes[index] = value & 0xff;
	}
	return decodeCp932(bytes);
}

/**
 * GARBro `IgaOpener.TryOpen`. The index length sits at 0x10 behind the signature. Records follow as
 * packed integers for the name offset, the data offset, and the size; behind them a packed length
 * sizes the name blob, which is stored as packed integers as well. Data offsets are relative to the
 * end of the name blob.
 */
async function readIgaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET + 1)) return undefined;
	const signature = (await source.readAt(0n, 4)).readUInt32LE(0);
	if (signature !== SIGNATURE) return undefined;
	const buffer = await source.readAt(0n, Number(source.size));
	const cursor: IgaCursor = { position: INDEX_OFFSET };
	const indexLength = readPackedUInt(buffer, cursor);
	if (indexLength === undefined) return undefined;
	const endPosition = cursor.position + indexLength;
	const records: { nameOffset: number; offset: number; size: number }[] = [];
	while (cursor.position < endPosition) {
		const nameOffset = readPackedUInt(buffer, cursor);
		const offset = readPackedUInt(buffer, cursor);
		const size = readPackedUInt(buffer, cursor);
		if (nameOffset === undefined || offset === undefined || size === undefined)
			return undefined;
		records.push({ nameOffset, offset, size });
	}
	const namesLength = readPackedUInt(buffer, cursor);
	if (namesLength === undefined) return undefined;
	const dataOffset = BigInt(cursor.position) + BigInt(namesLength);

	const entries: FixedEntry[] = [];
	for (const [id, record] of records.entries()) {
		const next = records[id + 1]?.nameOffset ?? namesLength;
		const nameLength = next - record.nameOffset;
		if (nameLength < 0) return undefined;
		const name = readPackedString(buffer, cursor, nameLength);
		if (name === undefined) return undefined;
		const offset = dataOffset + BigInt(record.offset);
		const size = BigInt(record.size);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
				metadata: { nameOffset: record.nameOffset },
			}),
		);
	}
	return entries;
}

/** GARBro `IgaOpener.OpenEntry`: a position-dependent XOR, with `*.s` scripts using a different key. */
const igaEntryOpener: FixedEntryOpener = async (source, entry) => {
	const payload = await source.readAt(entry.offset, Number(entry.size));
	const key = entry.path.toLowerCase().endsWith(`.${SCRIPT_EXTENSION}`)
		? XOR_KEY
		: 0;
	for (let position = 0; position < payload.length; position += 1) {
		payload[position] =
			(payload[position] ?? 0) ^ (((position + 2) ^ key) & 0xff);
	}
	return Readable.from([payload]);
};

export const igaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: igaDescriptor,
	detection: { signatures: [{ bytes: Buffer.from("IGA0", "ascii") }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readIgaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIgaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Noesis IGA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: igaEntryOpener,
});
