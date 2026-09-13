// Format reference: GARBro ArcFormats/Sohfu/ArcSKA.cs, class `SkaOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
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

const SIGNATURE = Buffer.from("IPF2", "ascii");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const NAME_SIZE = 0x10;
const RECORD_SIZE = 0x18;
/** Packed payloads carry the `LS8B` marker, the unpacked size and a header the decoder skips. */
const PACKED_SIGNATURE = Buffer.from("LS8B", "ascii");
const PACKED_HEADER_SIZE = 0xc;
const UNPACKED_SIZE_OFFSET = 4;
const FRAME_SIZE = 0x1000;
const FRAME_MASK = 0xfff;

/**
 * GARbro `SkaOpener.LzssUnpack`. A least-significant-bit-first control byte drives a 0x1000-byte
 * sliding window: a clear bit emits one literal byte, a set bit reads two bytes that encode the
 * distance in the high twelve bits and a length of three to eighteen in the low nibble. The window
 * position starts at 0xFFF and the copy reads one byte behind the position it writes, so overlapping
 * matches are expanded one byte at a time.
 */
export function unpackSohfuLzss(input: Buffer, unpackedSize: number): Buffer {
	const output = Buffer.alloc(unpackedSize);
	const frame = Buffer.alloc(FRAME_SIZE);
	let framePosition = FRAME_MASK;
	let source = 0;
	let control = 1;
	let destination = 0;
	while (destination < output.length) {
		if (control === 1) {
			if (source >= input.length) break;
			control = (input[source++] ?? 0) | 0x100;
		}
		if ((control & 1) === 0) {
			if (source >= input.length) break;
			const byte = input[source++] ?? 0;
			framePosition += 1;
			frame[framePosition & FRAME_MASK] = byte;
			output[destination++] = byte;
		} else {
			if (source + 1 >= input.length) break;
			const low = input[source++] ?? 0;
			const high = input[source++] ?? 0;
			const offset = (high << 4) | (low >> 4);
			let count = 3 + (low & 0x0f);
			while (count !== 0) {
				const value =
					frame[(offset + framePosition - FRAME_MASK) & FRAME_MASK] ?? 0;
				framePosition += 1;
				frame[framePosition & FRAME_MASK] = value;
				if (destination >= output.length)
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Truncated Sohfu LZSS match",
					);
				output[destination++] = value;
				count -= 1;
			}
		}
		control >>= 1;
	}
	return output;
}

/**
 * GARbro `SkaOpener.TryOpen`. The `IPF2` signature is followed by a record count and 0x18-byte index
 * records: a 0x10-byte field that holds the name, a NUL, and an optional CP932 extension, then the
 * payload offset and the stored size. A non-empty extension replaces the name's own extension.
 *
 * Whether a payload is packed is only decided from the stored data: a `LS8B` marker introduces the
 * declared unpacked size and a header the decoder skips, so the port probes each payload while parsing
 * and drops the header from the stored extent.
 */
async function readSkaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexLength = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexLength) > source.size) return undefined;

	const index = await source.readAt(BigInt(INDEX_OFFSET), indexLength);
	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		let name = decodeCStringField(index, record, NAME_SIZE);
		let nameLength = 0;
		while (nameLength < NAME_SIZE && (index[record + nameLength] ?? 0) !== 0)
			nameLength += 1;
		nameLength += 1;
		if (nameLength < NAME_SIZE) {
			const extension = decodeCStringField(
				index,
				record + nameLength,
				NAME_SIZE - nameLength,
			);
			if (extension.length > 0) name = changeExtension(name, extension);
		}
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE));
		const storedSize = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;

		if (
			storedSize >= BigInt(PACKED_HEADER_SIZE) &&
			(await source.readAt(offset, PACKED_SIGNATURE.length)).equals(
				PACKED_SIGNATURE,
			)
		) {
			const unpackedSize = BigInt(
				(
					await source.readAt(offset + BigInt(UNPACKED_SIZE_OFFSET), 4)
				).readUInt32LE(0),
			);
			entries.push(
				createFixedEntry({
					id,
					...normalizeEntryPath(name),
					offset: offset + BigInt(PACKED_HEADER_SIZE),
					size: unpackedSize,
					packedSize: storedSize - BigInt(PACKED_HEADER_SIZE),
					compressed: true,
				}),
			);
			continue;
		}
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
	}
	return entries;
}

/** GARbro `SkaOpener.OpenEntry`: `LS8B` payloads are decoded, everything else is emitted verbatim. */
const skaEntryOpener: FixedEntryOpener = async (source, entry) => {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([unpackSohfuLzss(stored, Number(entry.size))]);
};

export const sohfuSkaDescriptor: FormatDescriptor = {
	id: "sohfu-ska",
	name: "Sohfu resource archive",
	extensions: ["ska"],
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
			source: "ArcFormats/Sohfu/ArcSKA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const sohfuSkaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: sohfuSkaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readSkaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readSkaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Sohfu SKA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: skaEntryOpener,
});
