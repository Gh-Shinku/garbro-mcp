// Format reference: GARbro Legacy/BlackButterfly/ArcDAT.cs, class `DatOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PITA", "latin1");
const INDEX_START = 0x10;
/** Payloads start with their unpacked size. */
const SIZE_FIELD = 4;
/** Guard for the attacker-controlled unpacked size in a payload header. */
const MAX_UNPACKED_SIZE = 0x40000000;
/** Payload offsets are stored one past the entry count. */
const END_MARKER = 0x7f;

/**
 * GARbro `DatOpener.Unpack`. A byte oriented codec with six command forms. Two commands fill runs:
 * 0xE0 to 0xFE repeat zero, 0xC0 to 0xDF repeat a byte read from the stream, and 0xFF reads a run
 * length beyond 32. The remaining commands, 0x80 to 0x9F, copy literals from the stream, 0xA0 to 0xBF
 * interleave a zero with every literal, and 0x00 to 0x7E copy a match whose ten bit distance is
 * stored inverted.
 *
 * The reference copies into a fixed output buffer and reads behind it on a bad distance; the port
 * reports both, and the `7F FF` pair ends the stream.
 */
export function unpackPita(input: Uint8Array, outputLength: number): Buffer {
	const source = Buffer.from(input.buffer, input.byteOffset, input.byteLength);
	const output = Buffer.alloc(outputLength);
	let position = 0;
	let destination = 0;
	const write = (value: number): void => {
		if (destination >= output.length)
			throw new GarbroError("INVALID_ARCHIVE", "PITA output overflow");
		output[destination++] = value;
	};
	const readByte = (): number => {
		if (position >= source.length)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated PITA stream");
		return source[position++] ?? 0;
	};
	while (position < source.length) {
		const control = readByte();
		if (control === END_MARKER && source[position] === 0xff) break;
		if (control <= 0x7f) {
			const count = (control >> 2) + 2;
			const distance = (((control & 3) << 8) | readByte()) ^ 0x3ff;
			const origin = destination - distance - 1;
			if (origin < 0)
				throw new GarbroError("INVALID_ARCHIVE", "PITA match out of range");
			for (let index = 0; index < count; index += 1)
				write(output[origin + index] ?? 0);
		} else if (control > 0xfe) {
			const count = readByte() + 32;
			for (let index = 0; index < count; index += 1) write(0);
		} else if (control > 0xdf) {
			const count = (control & 0x1f) + 1;
			for (let index = 0; index < count; index += 1) write(0);
		} else if (control > 0xbf) {
			const count = (control & 0x1f) + 2;
			const fill = readByte();
			for (let index = 0; index < count; index += 1) write(fill);
		} else if (control > 0x9f) {
			const count = (control & 0x1f) + 1;
			for (let index = 0; index < count; index += 1) {
				write(0);
				write(readByte());
			}
		} else {
			const count = (control & 0x1f) + 1;
			for (let index = 0; index < count; index += 1) write(readByte());
		}
	}
	return output;
}

/**
 * GARbro `DatOpener.TryOpen`. The archive is a `PITA` marker, an entry count at 0x04, and an offset
 * table from 0x10 that holds one offset more than the entry count: entry sizes are the gaps between
 * consecutive offsets. Names are generated as five digit indexes with a `.bmp` extension and every
 * entry is an image.
 *
 * Stored sizes are known from the table, but the unpacked size lives in the payload's first word, so
 * the port reads it while listing to keep listing and extraction in agreement.
 */
async function readPitaIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;

	const table = await source
		.readAt(BigInt(INDEX_START), (count + 1) * 4)
		.catch(() => undefined);
	if (!table) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(table.readUInt32LE(id * 4));
		const end = BigInt(table.readUInt32LE(id * 4 + 4));
		const storedSize = end - offset;
		if (
			storedSize < BigInt(SIZE_FIELD) ||
			offset >= source.size ||
			storedSize > source.size ||
			offset > source.size - storedSize
		)
			return undefined;
		const sizeField = await source
			.readAt(offset, SIZE_FIELD)
			.catch(() => undefined);
		if (!sizeField) return undefined;
		const unpackedSize = sizeField.readUInt32LE(0);
		if (unpackedSize > MAX_UNPACKED_SIZE) return undefined;
		entries.push(
			createFixedEntry({
				id,
				path: `${id.toString().padStart(5, "0")}.bmp`,
				offset,
				size: BigInt(unpackedSize),
				packedSize: storedSize,
				compressed: true,
				metadata: { type: "image" },
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/** GARbro `DatOpener.OpenEntry`: the stored size field is dropped and the rest is unpacked. */
const pitaEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (entry.size > MAX_UNPACKED_SIZE)
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PITA output size");
	const payload = await source.readAt(
		entry.offset + BigInt(SIZE_FIELD),
		Number(entry.packedSize - BigInt(SIZE_FIELD)),
	);
	return Readable.from([unpackPita(payload, Number(entry.size))]);
};

export const blackButterflyDatDescriptor: FormatDescriptor = {
	id: "black-butterfly-dat",
	name: "Black Butterfly resource archive",
	extensions: [],
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
			source: "Legacy/BlackButterfly/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const blackButterflyDatFormat: ArchiveFormat = defineFixedArchive({
	descriptor: blackButterflyDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPitaIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readPitaIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid DAT/PITA layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pitaEntryOpener,
});
