// Format reference: GARbro Legacy/Inspire/ArcIDA.cs, classes `IdaOpener` and `RleDecompressor`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("XAF", "latin1");
const VERSION_FIELD = 4;
const MAX_VERSION = 0x011400;
const INDEX_OFFSET = 8;
/** Every index record starts with a fixed header and keeps its length in front of it. */
const RECORD_HEADER_SIZE = 0x28;
const RECORD_LENGTH_FIELD = 0;
const RECORD_OFFSET_FIELD = 4;
const RECORD_SIZE_FIELD = 8;
const RECORD_FLAGS_FIELD = 0x10;
const RECORD_KEY_FIELD = 0x14;
const NAME_FIELD = RECORD_HEADER_SIZE;
/** The name window has to hold any plausible record name. */
const NAME_WINDOW_SIZE = 0x400;
/** Flags decide which codecs run over a payload. */
const FLAG_NOT = 0x1;
const FLAG_XOR = 0x2;
const FLAG_ADD = 0x8;
const FLAG_DECRYPT = 0xb;
const FLAG_RLE = 0x4;
const FLAG_ZLIB = 0x10;
const FLAG_PACKED = FLAG_RLE | FLAG_ZLIB;
/** Length prefixes of the serialized names. */
const LENGTH_ESCAPE = 0xff;
const LENGTH_UTF16 = 0xfffe;
const LENGTH_LONG = 0xffff;
/** The rle stream starts with its own output size. */
const RLE_SIZE_SIZE = 4;
const RLE_LITERAL_FLAG = 0x80;
const RLE_REPEAT_FLAG = 0x40;
/** A guard against absurd output sizes in the rle header. */
const MAX_OUTPUT_SIZE = 0x10000000;

interface IdaEntry {
	name: string;
	offset: bigint;
	packedSize: bigint;
	size: bigint;
	flags: number;
	key: number;
}

async function readRange(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || length < 0) return undefined;
	if (BigInt(offset) + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), length));
}

/** `IdaOpener.DeserializeLength`: one byte, with escape values for wide and long lengths. */
function deserializeLength(
	view: Buffer,
	cursor: { position: number },
): number | undefined {
	if (cursor.position >= view.length) return undefined;
	const first = view[cursor.position];
	cursor.position += 1;
	if (first === undefined || first < LENGTH_ESCAPE) return first;
	if (cursor.position + 2 > view.length) return undefined;
	const value = view.readUInt16LE(cursor.position);
	cursor.position += 2;
	if (value === LENGTH_UTF16) return -1;
	if (value !== LENGTH_LONG) return value;
	if (cursor.position + 4 > view.length) return undefined;
	const length = view.readInt32LE(cursor.position);
	cursor.position += 4;
	return length;
}

/** `IdaOpener.DeserializeString`: a cp932 string, or a utf-16 one behind the -1 marker. */
function deserializeString(
	view: Buffer,
	cursor: { position: number },
): string | undefined {
	const length = deserializeLength(view, cursor);
	if (length === undefined) return undefined;
	if (length === 0) return "";
	if (length === -1) {
		const characters = deserializeLength(view, cursor);
		if (characters === undefined || characters < 0) return undefined;
		const bytes = characters * 2;
		if (cursor.position + bytes > view.length) return undefined;
		const name = view
			.subarray(cursor.position, cursor.position + bytes)
			.toString("utf16le");
		cursor.position += bytes;
		return name;
	}
	if (length < 0 || cursor.position + length > view.length) return undefined;
	const raw = view.subarray(cursor.position, cursor.position + length);
	cursor.position += length;
	const end = raw.indexOf(0);
	return decodeCp932(end === -1 ? raw : raw.subarray(0, end));
}

/**
 * GARbro `IdaOpener.TryOpen`. Records follow one another from 0x08, and the loop stops once the record
 * cursor has passed the payload of the first entry. A payload may not start in front of its own record.
 */
async function readIdaIndex(
	source: ByteSource,
): Promise<IdaEntry[] | undefined> {
	const header = await readRange(source, 0, INDEX_OFFSET);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	if (header.readInt32LE(VERSION_FIELD) > MAX_VERSION) return undefined;
	const entries: IdaEntry[] = [];
	let indexPosition = INDEX_OFFSET;
	let packedFound = false;
	while (true) {
		const record = await readRange(source, indexPosition, RECORD_HEADER_SIZE);
		if (!record) return undefined;
		const entryLength = record.readUInt32LE(RECORD_LENGTH_FIELD);
		if (entryLength === 0) break;
		if (entryLength < RECORD_HEADER_SIZE) return undefined;
		// The whole record has to be inside the file.
		if (BigInt(indexPosition) + BigInt(entryLength) > source.size)
			return undefined;
		const windowSize = Math.min(
			NAME_WINDOW_SIZE,
			Number(source.size) - (indexPosition + NAME_FIELD),
		);
		const window = await readRange(
			source,
			indexPosition + NAME_FIELD,
			windowSize,
		);
		if (!window) return undefined;
		const cursor = { position: 0 };
		const name = deserializeString(
			window.subarray(0, entryLength - RECORD_HEADER_SIZE),
			cursor,
		);
		if (name === undefined) return undefined;
		const offset = BigInt(record.readUInt32LE(RECORD_OFFSET_FIELD));
		const declaredSize = BigInt(record.readUInt32LE(RECORD_SIZE_FIELD));
		const flags = record.readUInt32LE(RECORD_FLAGS_FIELD);
		const key = record.readUInt32LE(RECORD_KEY_FIELD);
		indexPosition += entryLength;
		if (offset > source.size || BigInt(indexPosition) > offset)
			return undefined;
		const packed = (flags & FLAG_PACKED) !== 0;
		packedFound = packedFound || packed;
		entries.push({
			name,
			offset,
			packedSize: declaredSize,
			size: declaredSize,
			flags,
			key,
		});
		const first = entries[0];
		if (first && BigInt(indexPosition) >= first.offset) break;
	}
	if (entries.length === 0) return undefined;
	if (packedFound) {
		// Packed archives report adjacent offsets instead of the sizes in the index.
		let lastOffset = source.size;
		for (let id = entries.length - 1; id >= 0; id -= 1) {
			const entry = entries[id];
			if (!entry) continue;
			entries[id] = { ...entry, packedSize: lastOffset - entry.offset };
			lastOffset = entry.offset;
		}
	}
	return entries;
}

/** `IdaOpener.DecryptEntry`: the flags decide which of add, xor and complement run, and each byte keys the next. */
export function decryptIdaEntry(
	input: Buffer,
	flags: number,
	key: number,
): Buffer {
	const output = Buffer.from(input);
	let current = key & 0xff;
	for (let position = 0; position < output.length; position += 1) {
		let value = output[position] ?? 0;
		if ((flags & FLAG_ADD) !== 0) value = (value + current) & 0xff;
		if ((flags & FLAG_XOR) !== 0) value ^= current;
		if ((flags & FLAG_NOT) !== 0) value ^= 0xff;
		output[position] = value;
		current = value;
	}
	return output;
}

/** The rle variant of `IdaOpener`: literals and byte runs sized by the low bits of the control byte. */
export function inflateIdaRle(input: Buffer): Buffer {
	if (input.length < RLE_SIZE_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Truncated Inspire RLE stream");
	const size = input.readInt32LE(0);
	if (size < 0 || size > MAX_OUTPUT_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Inspire RLE output size");
	const output = Buffer.alloc(size);
	let position = RLE_SIZE_SIZE;
	let written = 0;
	while (written < size) {
		if (position >= input.length) break;
		const control = input[position] ?? 0;
		position += 1;
		let count: number;
		if ((control & RLE_LITERAL_FLAG) === 0) {
			count = control & 0x3f;
		} else if ((control & 3) === 0) {
			if (position >= input.length) break;
			count = input[position] ?? 0;
			position += 1;
		} else if ((control & 3) === 1) {
			if (position + 2 > input.length) break;
			count = input.readUInt16LE(position);
			position += 2;
		} else if ((control & 3) === 3) {
			if (position + 4 > input.length) break;
			count = input.readInt32LE(position);
			position += 4;
		} else {
			// The reference leaves the count at zero for this combination, which cannot make progress.
			break;
		}
		count = Math.min(Math.max(count, 0), size - written);
		if (count === 0) break;
		if ((control & RLE_REPEAT_FLAG) !== 0) {
			if (position >= input.length) break;
			const value = input[position] ?? 0;
			position += 1;
			output.fill(value, written, written + count);
		} else {
			const available = Math.min(count, input.length - position);
			if (available <= 0) break;
			input.copy(output, written, position, position + available);
			position += available;
			count = available;
		}
		written += count;
	}
	return output.subarray(0, written);
}

function toFixedEntries(entries: readonly IdaEntry[]): FixedEntry[] {
	return entries.map((entry, id) => {
		const compressed = (entry.flags & FLAG_PACKED) !== 0;
		const fixed = createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			packedSize: entry.packedSize,
			compressed,
			encrypted: (entry.flags & FLAG_DECRYPT) !== 0,
			metadata: { type: "data", flags: entry.flags, key: entry.key },
		});
		return entry.size === 0n ? { ...fixed, sizeKnown: false } : fixed;
	});
}

export const idaDescriptor: FormatDescriptor = {
	id: "inspire-ida",
	name: "Inspire resource archive",
	extensions: ["ida", "mha"],
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
			source: "Legacy/Inspire/ArcIDA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const idaFormat = defineFixedArchive({
	descriptor: idaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readIdaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIdaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Inspire IDA layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	/** `IdaOpener.OpenEntry` decrypts first, then unpacks rle, then zlib. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.packedSize)),
		);
		const flags = Number(entry.metadata?.flags ?? 0);
		const key = Number(entry.metadata?.key ?? 0);
		if (flags === 0) return Readable.from([stored]);
		try {
			let data: Buffer = stored;
			if ((flags & FLAG_DECRYPT) !== 0)
				data = decryptIdaEntry(data, flags, key);
			if ((flags & FLAG_RLE) !== 0) data = inflateIdaRle(data);
			if ((flags & FLAG_ZLIB) !== 0)
				data = await inflateZlibBuffer(data, Number(entry.size));
			return Readable.from([data]);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Inspire payload");
		}
	},
});
