// Format reference: GARBro ArcFormats/ArcSPack.cs, classes `DatOpener` and `PackedReader`, with
// `NotTransform` from ArcFormats/SimpleEncryption.cs.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The head reads `SPac`, then `k` and a null byte, then the version word. */
const SIGNATURE = Buffer.from("SPac", "ascii");
const MARKER_OFFSET = 4;
const MARKER = 0x6b;
const VERSION_OFFSET = 6;
const VERSION = 1;
const DATA_SIZE_OFFSET = 8;
const COUNT_OFFSET = 0x10;
const COUNT_LIMIT = 0xfffff;
const BASE_OFFSET = 0x18;
const HEADER_SIZE = BASE_OFFSET;
const RECORD_SIZE = 0x38;
const NAME_SIZE = 0x20;
const OFFSET_FIELD = 0x20;
const UNPACKED_SIZE_FIELD = 0x24;
const SIZE_FIELD = 0x28;
const METHOD_FIELD = 0x2c;
const CRC_FIELD = 0x2e;
/** Payload handling: stored, bitwise inverted, or LZ packed. */
const METHOD_STORED = 0;
const METHOD_INVERTED = 1;
const METHOD_PACKED = 2;
/** Short match offsets start above ten and the long form extends the stored nibble. */
const SHORT_OFFSET_LIMIT = 10;
const EXTENDED_COUNT = 15;
const BYTE_COUNT = 14;
/** A control word carries one flag per token, most significant bit first. */
const CONTROL_BIT = 0x80000000;

export const spackDescriptor: FormatDescriptor = {
	id: "spack-dat",
	name: "SPack resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/ArcSPack.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/SimpleEncryption.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PackedReader.Unpack`. Tokens are read against a 32-bit little-endian control word whose most
 * significant bit flags the first token, and a set bit introduces a match rather than a literal.
 *
 * A match starts with one byte holding a count nibble and an offset nibble. Counts above thirteen are
 * extended by a byte or a word, and offsets of ten and above are extended by a further byte, while
 * anything below ten is stored as one less than its real distance. Copies overlap byte by byte and are
 * clamped to the declared output length, so the loop ends when the output is full.
 */
function unpackSPack(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let destination = 0;
	let source = 0;
	let control = 0;
	let mask = 0;
	while (destination < output.length && source < input.length) {
		if (mask === 0) {
			control = input.readUInt32LE(source);
			source += 4;
			mask = CONTROL_BIT;
		}
		if ((control & mask) !== 0) {
			let code = input[source++] ?? 0;
			let count = code >> 4;
			let offset = code & 0x0f;
			if (count === EXTENDED_COUNT) {
				count = input.readUInt16LE(source);
				source += 2;
			} else if (count === BYTE_COUNT) {
				count = input[source++] ?? 0;
			} else {
				count += 1;
			}
			if (offset < SHORT_OFFSET_LIMIT) {
				offset += 1;
			} else {
				offset = ((offset - SHORT_OFFSET_LIMIT) << 8) | (input[source++] ?? 0);
			}
			if (destination + count > output.length)
				count = output.length - destination;
			for (let index = 0; index < count; index += 1) {
				output[destination] = output[destination - offset] ?? 0;
				destination += 1;
			}
		} else {
			output[destination] = input[source++] ?? 0;
			destination += 1;
		}
		mask >>>= 1;
	}
	return output;
}

/**
 * GARBro `DatOpener.TryOpen`. The head spells `SPack`, the version word at 6 must be one, a data size
 * sits at 8, and the entry count at 0x10 is bounded at 0xFFFFF. Payloads start at 0x18 and the index
 * follows them at `0x18 + data_size`, where each 0x38-byte record holds a 0x20-byte name field and then
 * a data offset relative to 0x18, the unpacked size, the stored size, a method byte, a padding byte,
 * and a CRC word.
 *
 * Extraction follows the method: zero copies the stored bytes, one inverts them because the reference
 * wraps them in `NotTransform`, two runs the LZ unpacker, and any other value falls back to a verbatim
 * copy. The CRC is not verified, since the reference only records it.
 */
async function readSpackIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	if ((header[MARKER_OFFSET] ?? 0) !== MARKER) return undefined;
	if (header.readUInt16LE(VERSION_OFFSET) !== VERSION) return undefined;
	const dataSize = BigInt(header.readUInt32LE(DATA_SIZE_OFFSET));
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > COUNT_LIMIT) return undefined;
	const indexOffset = BigInt(BASE_OFFSET) + dataSize;
	const indexSize = count * RECORD_SIZE;
	if (indexOffset >= source.size) return undefined;
	if (indexOffset + BigInt(indexSize) > source.size) return undefined;
	const index = await source.readAt(indexOffset, indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0) return undefined;
		const offset =
			BigInt(BASE_OFFSET) + BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const method = index.readUInt8(record + METHOD_FIELD);
		const crc = index.readUInt16LE(record + CRC_FIELD);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const packed = method !== METHOD_STORED;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: packed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed: packed,
				metadata: {
					method,
					crc,
					unpackedSize,
					...(sourceExtension(name) === "dat" ? { inferredType: "audio" } : {}),
				},
			}),
		);
	}
	return entries;
}

/** GARBro `DatOpener.OpenEntry`: the method selects inversion, LZ unpacking, or a verbatim copy. */
async function openSpackEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const method =
		typeof entry.metadata?.method === "number" ? entry.metadata.method : 0;
	if (method !== METHOD_INVERTED && method !== METHOD_PACKED)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (method === METHOD_INVERTED) {
		for (let position = 0; position < stored.length; position += 1)
			stored[position] = ~(stored[position] ?? 0) & 0xff;
		return Readable.from([stored]);
	}
	return Readable.from([
		unpackSPack(stored, Number(entry.metadata?.unpackedSize ?? entry.size)),
	]);
}

export const spackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: spackDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSpackIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSpackIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SPack archive layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openSpackEntry,
});
