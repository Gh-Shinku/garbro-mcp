// Format reference: GARbro ArcFormats/Interheart/ArcFPK.cs, classes `FpkOpener` and `Zlc2Reader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
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

const COUNT_FIELD = 0;
const INDEX_OFFSET = 4;
/** Every record is an offset, a size and a fixed name field. */
const RECORD_PREFIX_SIZE = 8;
const NAME_SIZES = [0x10, 0x18];
/** An encrypted index keeps four more bytes in front of a full name field. */
const ENCRYPTED_NAME_SIZE = 0x18;
const ENCRYPTED_RECORD_PREFIX_SIZE = 0xc;
/** The index offset and its key sit at the very end of the file. */
const TRAILER_SIZE = 8;
const KEY_SIZE = 4;
/** Payloads may be wrapped in nested `ZLC2` streams. */
const PACKED_SIGNATURE = 0x32434c5a;
const ZLC2_HEADER_SIZE = 8;
const ZLC2_OUTPUT_SIZE_FIELD = 4;
const COPY_MIN_COUNT = 3;
const FRAME_SIZE = 0x1000;
const MAX_OUTPUT_SIZE = 0x10000000;
/** Guards against a crafted stream that never stops wrapping itself. */
const MAX_LAYERS = 32;

interface FpkEntry {
	name: string;
	offset: bigint;
	size: bigint;
}

async function readRange(
	source: ByteSource,
	offset: bigint,
	length: number,
): Promise<Buffer | undefined> {
	if (length < 0 || offset < 0n) return undefined;
	if (offset + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(offset, length));
}

/** Names are cp932 strings cut at their first NUL; a blank name declines the archive. */
function decodeName(bytes: Buffer): string | undefined {
	const end = bytes.indexOf(0);
	const name = decodeCp932(end === -1 ? bytes : bytes.subarray(0, end));
	if (name.trim() === "") return undefined;
	return name;
}

/** `FpkOpener.ReadIndex`: the plain layout, where the payloads start behind the index. */
async function readPlainIndex(
	source: ByteSource,
	count: number,
	nameSize: number,
): Promise<FpkEntry[] | undefined> {
	const recordSize = RECORD_PREFIX_SIZE + nameSize;
	const indexSize = recordSize * count;
	const index = await readRange(source, BigInt(INDEX_OFFSET), indexSize);
	if (!index) return undefined;
	const dataOffset = BigInt(INDEX_OFFSET + indexSize);
	const entries: FpkEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * recordSize;
		const name = decodeName(
			index.subarray(position + RECORD_PREFIX_SIZE, position + recordSize),
		);
		if (name === undefined) return undefined;
		const offset = BigInt(index.readUInt32LE(position));
		const size = BigInt(index.readUInt32LE(position + 4));
		if (offset < dataOffset) return undefined;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({ name, offset, size });
	}
	return entries;
}

/**
 * `FpkOpener.ReadEncryptedIndex`: a negative count switches to an index at the end of the file, whose bytes
 * are xored with a four byte key stored just before its offset.
 */
async function readEncryptedIndex(
	source: ByteSource,
	count: number,
): Promise<FpkEntry[] | undefined> {
	if (source.size < BigInt(TRAILER_SIZE)) return undefined;
	const trailer = await readRange(
		source,
		source.size - BigInt(TRAILER_SIZE),
		TRAILER_SIZE,
	);
	if (!trailer) return undefined;
	const indexOffset = BigInt(trailer.readUInt32LE(4));
	if (indexOffset < 4n || indexOffset >= source.size - BigInt(TRAILER_SIZE))
		return undefined;
	const key = trailer.subarray(0, KEY_SIZE);
	const recordSize = ENCRYPTED_RECORD_PREFIX_SIZE + ENCRYPTED_NAME_SIZE;
	const indexSize = recordSize * count;
	const index = await readRange(source, indexOffset, indexSize);
	if (!index) return undefined;
	for (let position = 0; position < index.length; position += 1)
		index[position] = (index[position] ?? 0) ^ (key[position & 3] ?? 0);
	const entries: FpkEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const position = id * recordSize;
		const name = decodeName(
			index.subarray(
				position + ENCRYPTED_RECORD_PREFIX_SIZE,
				position + recordSize,
			),
		);
		if (name === undefined) return undefined;
		const offset = BigInt(index.readUInt32LE(position));
		const size = BigInt(index.readUInt32LE(position + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({ name, offset, size });
	}
	return entries;
}

/**
 * GARbro `FpkOpener.TryOpen`. A negative count selects the encrypted index; otherwise the index is tried with
 * a sixteen byte name field first and retried with a twenty four byte one.
 */
async function readFpkIndex(
	source: ByteSource,
): Promise<FpkEntry[] | undefined> {
	const header = await readRange(
		source,
		BigInt(COUNT_FIELD),
		INDEX_OFFSET - COUNT_FIELD,
	);
	if (!header) return undefined;
	const count = header.readInt32LE(0);
	if (count < 0) {
		const positive = count & 0x7fffffff;
		if (!isSaneCount(positive)) return undefined;
		return readEncryptedIndex(source, positive);
	}
	if (!isSaneCount(count)) return undefined;
	for (const nameSize of NAME_SIZES) {
		const entries = await readPlainIndex(source, count, nameSize);
		if (entries) return entries;
	}
	return undefined;
}

/**
 * `Zlc2Reader.Unpack`: a control byte holds eight decisions, most significant bit first. A set bit is a
 * literal, a clear bit a back reference of two bytes, where the high nibble of the second one extends the
 * offset and its low nibble carries the length. The reference copies with overlap, so a run may repeat the
 * bytes it just wrote.
 */
export function inflateZlc2(input: Buffer): Buffer {
	if (input.length < ZLC2_HEADER_SIZE)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Truncated Interheart ZLC2 stream",
		);
	const outputLength = input.readUInt32LE(ZLC2_OUTPUT_SIZE_FIELD);
	if (outputLength > MAX_OUTPUT_SIZE)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Invalid Interheart ZLC2 output size",
		);
	const output = Buffer.alloc(outputLength);
	let position = ZLC2_HEADER_SIZE;
	let remaining = input.length - ZLC2_HEADER_SIZE;
	let target = 0;
	while (remaining > 0 && target < output.length) {
		const control = input[position] ?? 0;
		position += 1;
		remaining -= 1;
		for (
			let mask = 0x80;
			mask !== 0 && remaining > 0 && target < output.length;
			mask >>= 1
		) {
			if ((control & mask) !== 0) {
				if (remaining < 2) return output.subarray(0, target);
				const first = input[position] ?? 0;
				const second = input[position + 1] ?? 0;
				position += 2;
				remaining -= 2;
				let offset = first | ((second & 0xf0) << 4);
				let count = (second & 0x0f) + COPY_MIN_COUNT;
				if (offset === 0) offset = FRAME_SIZE;
				if (target + count > output.length) count = output.length - target;
				for (let index = 0; index < count; index += 1) {
					output[target] = output[target - offset] ?? 0;
					target += 1;
				}
			} else {
				output[target] = input[position] ?? 0;
				position += 1;
				remaining -= 1;
				target += 1;
			}
		}
	}
	return output.subarray(0, target);
}

function toFixedEntries(entries: readonly FpkEntry[]): FixedEntry[] {
	return entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			metadata: { type: "data" },
		}),
	);
}

export const fpkDescriptor: FormatDescriptor = {
	id: "interheart-fpk",
	name: "Interheart/Candy Soft resource archive",
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
			source: "ArcFormats/Interheart/ArcFPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const fpkFormat = defineFixedArchive({
	descriptor: fpkDescriptor,
	// The reference accepts any file, so the content of the index is the whole gate.
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readFpkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readFpkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart FPK layout");
		return {
			entries: toFixedEntries(entries),
			metadata: { entryCount: entries.length },
		};
	},
	/** `FpkOpener.OpenEntry` unwraps every nested `ZLC2` layer around the payload. */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		let data: Buffer = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		try {
			for (let layer = 0; layer < MAX_LAYERS; layer += 1) {
				if (
					data.length <= ZLC2_HEADER_SIZE ||
					data.readUInt32LE(0) !== PACKED_SIGNATURE
				)
					break;
				data = inflateZlc2(data);
			}
			return Readable.from([data]);
		} catch (error) {
			if (error instanceof GarbroError) throw error;
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Interheart payload");
		}
	},
});
