// Format reference: GARBro Legacy/Sogna/ArcSGS.cs, class `SgsDatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
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
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** `SGS.` plus `AsciiEqual (4, "DAT 1.00")`. */
const SIGNATURE = Buffer.from("SGS.DAT 1.00", "ascii");
const COUNT_OFFSET = 0x0c;
const INDEX_OFFSET = 0x10;
/** A record is a 0x10-byte name field, a packed flag, the stored and unpacked sizes, and an offset. */
const NAME_SIZE = 0x10;
const PACKED_FIELD = 0x13;
const SIZE_FIELD = 0x14;
const UNPACKED_SIZE_FIELD = 0x18;
const OFFSET_FIELD = 0x1c;
const RECORD_SIZE = 0x20;

export const sognaDatDescriptor: FormatDescriptor = {
	id: "sogna-dat",
	name: "Sogna resource archive",
	extensions: ["dat"],
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
			source: "Legacy/Sogna/ArcSGS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readSgsIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const packed = (index[record + PACKED_FIELD] ?? 0) !== 0;
		const storedSize = BigInt(index.readUInt32LE(record + SIZE_FIELD));
		const unpackedSize = BigInt(
			index.readUInt32LE(record + UNPACKED_SIZE_FIELD),
		);
		const offset = BigInt(index.readUInt32LE(record + OFFSET_FIELD));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: packed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed: packed,
			}),
		);
	}
	return entries;
}

/**
 * GARbro `SgsDatOpener.LzUnpack`: a control byte supplies eight flags from its high bits. A set flag
 * reads a little-endian word whose low twelve bits are the distance back into the already-decoded
 * output and whose high four bits plus one give the copy length. A clear flag reads one literal byte.
 * Decoding stops when the declared output size is reached or the input ends, so the returned buffer
 * always has exactly the declared length.
 */
export function inflateSognaLz(
	input: Uint8Array,
	outputLength: number,
): Buffer {
	const output = Buffer.alloc(outputLength);
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	let sourcePosition = 0;
	let destination = 0;
	let flags = 0;
	let mask = 0;
	while (destination < output.length) {
		mask >>= 1;
		if (mask === 0) {
			if (sourcePosition >= source.length) break;
			flags = source[sourcePosition++] ?? 0;
			mask = 0x80;
		}
		if ((mask & flags) !== 0) {
			if (sourcePosition + 2 > source.length) break;
			const word =
				(source[sourcePosition] ?? 0) |
				((source[sourcePosition + 1] ?? 0) << 8);
			sourcePosition += 2;
			const count = (word >> 12) + 1;
			const distance = word & 0xfff;
			const from = destination - distance;
			for (
				let index = 0;
				index < count && destination < output.length;
				index += 1
			) {
				output[destination] = output[from + index] ?? 0;
				destination += 1;
			}
		} else {
			if (sourcePosition >= source.length) break;
			output[destination++] = source[sourcePosition++] ?? 0;
		}
	}
	return output;
}

/** GARbro `SgsDatOpener.OpenEntry`: packed payloads use the custom Sogna LZ scheme. */
const sognaEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(
		entry.offset,
		bigintToBufferLength(entry.packedSize, "Sogna entry"),
	);
	return Readable.from([
		inflateSognaLz(stored, bigintToBufferLength(entry.size, "Sogna output")),
	]);
};

export const sognaDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sognaDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSgsIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSgsIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Sogna SGS layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: sognaEntryOpener,
});
