// Format reference: GARBro ArcFormats/Kaguya/ArcUF.cs, class `UfOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { MsbBitReader } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	decodeCp932,
	type FormatDescriptor,
	GarbroError,
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

const SIGNATURE = Buffer.from("UF01", "ascii");
const INDEX_OFFSET_FIELD = 4;
const /** Payloads begin right after the eight-byte header. */ DATA_START = 8;
const MAX_NAME_LENGTH = 0x100;
const FLAGS_SIZE = 2;
const LENGTH_SIZE = 4;
const SIZE_FIELD_SIZE = 4;
/** Packed payloads are preceded by a four-byte unpacked size. */
const PACKED_PREFIX_SIZE = 4;
const PACKED_FLAG = 1;
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;
const OFFSET_BITS = 12;
const COUNT_BITS = 4;
/** Encrypted names are simply inverted. */
const NAME_KEY = 0xff;

/**
 * GARbro `UfOpener.LzUnpack`. The most-significant-bit-first control bit selects between an eight-bit
 * literal, which is appended to a 0x1000-byte window whose write position starts at one, and a match
 * whose twelve-bit offset indexes the window absolutely while its four-bit count adds two. The window
 * position only decides where decoded bytes are stored.
 */
export function unpackUfEntry(input: Buffer, unpackedSize: number): Buffer {
	const output = Buffer.alloc(unpackedSize);
	const frame = Buffer.alloc(FRAME_SIZE);
	const bits = new MsbBitReader(input);
	let framePosition = 1;
	let destination = 0;
	while (destination < output.length) {
		// A truncated stream reports -1, which the reference treats as a set bit and as 0xFF bytes.
		if (bits.tryReadBits(1) !== 0) {
			const byte = bits.tryReadBits(8) & 0xff;
			output[destination++] = byte;
			frame[framePosition++ & FRAME_MASK] = byte;
		} else {
			const offset = bits.tryReadBits(OFFSET_BITS);
			const count = bits.tryReadBits(COUNT_BITS) + 2;
			for (let index = 0; index < count; index += 1) {
				if (destination >= output.length)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated UF01 match");
				const byte = frame[(offset + index) & FRAME_MASK] ?? 0;
				output[destination++] = byte;
				frame[framePosition++ & FRAME_MASK] = byte;
			}
		}
	}
	return output;
}

/**
 * GARbro `UfOpener.TryOpen`. The `UF01` signature is followed by a 32-bit index offset and an eight-byte
 * header; the index itself sits four bytes past that offset. Index records run until the index stream
 * runs out and hold an inverted CP932 name with a 32-bit length, a 16-bit flags word and the stored
 * size. Payload offsets are not stored: the reference derives them by walking the records, adding the
 * four-byte unpacked size that precedes packed payloads. Flags of one mark an entry as packed, and
 * leading path separators are trimmed from names.
 */
async function readUfIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DATA_START)) return undefined;
	const header = await source.readAt(0n, DATA_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexOffset = BigInt(header.readUInt32LE(INDEX_OFFSET_FIELD));
	if (indexOffset + BigInt(SIZE_FIELD_SIZE) > source.size) return undefined;

	const indexLength = Number(
		source.size - indexOffset - BigInt(SIZE_FIELD_SIZE),
	);
	const index = await source.readAt(
		indexOffset + BigInt(SIZE_FIELD_SIZE),
		indexLength,
	);
	const entries: FixedEntry[] = [];
	let position = 0;
	let dataOffset = BigInt(DATA_START);
	while (position < index.length) {
		if (position + LENGTH_SIZE > index.length) return undefined;
		const nameLength = index.readInt32LE(position);
		if (nameLength <= 0 || nameLength > MAX_NAME_LENGTH) return undefined;
		if (
			position + LENGTH_SIZE + nameLength + FLAGS_SIZE + SIZE_FIELD_SIZE >
			index.length
		)
			return undefined;
		const encrypted = index.subarray(
			position + LENGTH_SIZE,
			position + LENGTH_SIZE + nameLength,
		);
		const decrypted = Buffer.from(encrypted);
		for (let index2 = 0; index2 < decrypted.length; index2 += 1)
			decrypted[index2] = (decrypted[index2] ?? 0) ^ NAME_KEY;
		const name = decodeCp932(decrypted).replace(/^[\\/]+/, "");
		const flags = index.readInt16LE(position + LENGTH_SIZE + nameLength);

		dataOffset += BigInt(
			LENGTH_SIZE + nameLength + FLAGS_SIZE + SIZE_FIELD_SIZE,
		);
		const size = BigInt(
			index.readUInt32LE(position + LENGTH_SIZE + nameLength + FLAGS_SIZE),
		);
		if (!checkPlacement(dataOffset, size, source.size)) return undefined;
		const packed = flags === PACKED_FLAG;
		if (packed) {
			// The reference reads the unpacked size lazily; probing it here keeps listing and
			// extraction consistent. A zero size makes the reference return an empty stream.
			if (size < BigInt(PACKED_PREFIX_SIZE)) return undefined;
			const unpackedSize = BigInt(
				(await source.readAt(dataOffset, PACKED_PREFIX_SIZE)).readUInt32LE(0),
			);
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(name),
					offset: dataOffset + BigInt(PACKED_PREFIX_SIZE),
					size: unpackedSize,
					packedSize: size,
					compressed: true,
				}),
			);
		} else {
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(name),
					offset: dataOffset,
					size,
					packedSize: size,
				}),
			);
		}
		dataOffset += size;
		if (packed) dataOffset += BigInt(PACKED_PREFIX_SIZE);
		position += LENGTH_SIZE + nameLength + FLAGS_SIZE + SIZE_FIELD_SIZE;
	}
	return entries;
}

/**
 * GARbro `UfOpener.OpenEntry`. Unpacked payloads are plain byte ranges. Packed payloads keep their
 * unpacked size in the first four bytes; a size of zero yields an empty stream, and otherwise the LZ
 * stream behind the prefix fills exactly that many bytes.
 */
const ufEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	if (entry.size === 0n) return Readable.from([Buffer.alloc(0)]);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	return Readable.from([unpackUfEntry(stored, Number(entry.size))]);
};

export const kaguyaUfDescriptor: FormatDescriptor = {
	id: "kaguya-uf",
	name: "Atelier Kaguya resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Kaguya/ArcUF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const kaguyaUfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: kaguyaUfDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readUfIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readUfIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid UF01 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: ufEntryOpener,
});
