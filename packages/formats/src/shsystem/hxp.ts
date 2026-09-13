// Format reference: GARBro ArcFormats/SHSystem/ArcHXP.cs, classes `Him4Opener`, `Him5Opener` and
// `ShsCompression`.
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
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "hxp";
/** Every payload begins with a stored size and an unpacked size, and its data follows that pair. */
const SIZE_PAIR = 8;
const STORED_SIZE_FIELD = 0;
const UNPACKED_SIZE_FIELD = 4;
const WORD_SIZE = 4;

const HIM4_SIGNATURES = [
	Buffer.from("Him4", "ascii"),
	Buffer.from("SHS6", "ascii"),
];
const HIM4_COUNT_OFFSET = 4;
const HIM4_FIRST_OFFSET_FIELD = 8;
const HIM4_INDEX_OFFSET = 0xc;
const GENERATED_NAME_DIGITS = 5;

const HIM5_SIGNATURES = [
	Buffer.from("Him5", "ascii"),
	Buffer.from("SHS7", "ascii"),
];
const HIM5_COUNT_OFFSET = 4;
const HIM5_SECTION_INDEX_OFFSET = 8;
const SECTION_RECORD_SIZE = 8;
/** A section entry is a one-byte length, a big-endian offset and a name behind them. */
const SECTION_ENTRY_OFFSET_FIELD = 1;
const SECTION_ENTRY_NAME_OFFSET = 5;
const MINIMUM_ENTRY_SIZE = 5;

const ATTRIBUTION = [
	{
		project: "GARbro",
		source: "ArcFormats/SHSystem/ArcHXP.cs",
		license: "MIT",
		commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
	},
] as const;

export const him4Descriptor: FormatDescriptor = {
	id: "shsystem-him4",
	name: "SH System engine resource archive",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

export const him5Descriptor: FormatDescriptor = {
	id: "shsystem-him5",
	name: "SH System engine resource archive, version 5",
	extensions: [EXTENSION],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: ATTRIBUTION,
};

/**
 * GARBro `ShsCompression.Unpack`. A control byte below 0x20 introduces a literal run whose length is that byte
 * plus one, with three escapes for longer runs: 0x1D takes a byte and adds 0x1E, 0x1E takes a big-endian word
 * and adds 0x11E, and 0x1F takes a big-endian long outright.
 *
 * Any other control byte introduces a match in one of three forms. The small form packs both values into the
 * control byte; the middle form takes an offset byte and either a count from the control byte or, when the
 * control's bits are clear, an extended count behind it; the form with the top bit set takes a low offset byte.
 * In every form the count ends up three larger and the distance one larger, copies overlap byte by byte, and a
 * count that would leave the output is clamped so the loop fills the declared length exactly.
 *
 * The reference reads without checking bounds, so a truncated stream would overrun; the port stops instead.
 */
export function decompressShs(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let destination = 0;
	let source = 0;
	const byte = (): number | undefined =>
		source < input.length ? (input[source++] ?? 0) : undefined;
	const word16 = (): number | undefined => {
		if (source + 2 > input.length) return undefined;
		const value = input.readUInt16BE(source);
		source += 2;
		return value;
	};
	const word32 = (): number | undefined => {
		if (source + 4 > input.length) return undefined;
		const value = input.readInt32BE(source);
		source += 4;
		return value;
	};

	while (destination < outputLength) {
		const control = byte();
		if (control === undefined) break;
		if (control < 0x20) {
			let count: number | undefined;
			if (control === 0x1d) {
				const value = byte();
				count = value === undefined ? undefined : value + 0x1e;
			} else if (control === 0x1e) {
				const value = word16();
				count = value === undefined ? undefined : value + 0x11e;
			} else if (control === 0x1f) {
				count = word32();
			} else {
				count = control + 1;
			}
			if (count === undefined) break;
			const length = Math.min(count, outputLength - destination);
			if (source + length > input.length) break;
			input.copy(output, destination, source, source + length);
			source += length;
			destination += length;
			continue;
		}

		let distance = 0;
		let count = 0;
		if ((control & 0x80) !== 0) {
			count = ((control >> 5) & 3) + 3;
			const low = byte();
			if (low === undefined) break;
			distance = (((control & 0x1f) << 8) | low) + 1;
		} else if ((control & 0x60) === 0x20) {
			distance = ((control >> 2) & 7) + 1;
			count = (control & 3) + 3;
		} else {
			const offsetByte = byte();
			if (offsetByte === undefined) break;
			distance = offsetByte + 1;
			if ((control & 0x60) === 0x40) {
				count = (control & 0x1f) + 7;
			} else {
				distance = (((control & 0x1f) << 8) | offsetByte) + 1;
				const extended = byte();
				if (extended === undefined) break;
				if (extended === 0xfe) {
					const value = word16();
					if (value === undefined) break;
					count = value + 0x102;
				} else if (extended === 0xff) {
					const value = word32();
					if (value === undefined) break;
					count = value;
				} else {
					count = extended + 7;
				}
			}
		}
		if (count <= 0 || distance <= 0) break;
		const length = Math.min(count, outputLength - destination);
		for (let index = 0; index < length; index += 1) {
			output[destination] = output[destination - distance] ?? 0;
			destination += 1;
		}
	}
	return output;
}

/**
 * GARBro `Him4Opener.DetectFileTypes`, shared by both versions. Every payload starts with a stored size and an
 * unpacked size, and the data begins behind that pair. A stored size of zero means the payload is plain, in
 * which case the two sizes agree; otherwise the entry is compressed and the stored size is what the archive
 * holds while the unpacked size is what extraction produces. The reference then probes the first bytes to
 * classify the entry through its catalog, which the port leaves out since neither version names its entries by
 * extension in a way that classification would change.
 */
export async function buildShsEntry(
	source: ByteSource,
	id: number,
	offset: bigint,
	archiveSize: bigint,
): Promise<FixedEntry | undefined> {
	if (offset + BigInt(SIZE_PAIR) > archiveSize) return undefined;
	const sizes = await source.readAt(offset, SIZE_PAIR);
	const stored = sizes.readUInt32LE(STORED_SIZE_FIELD);
	const unpacked = sizes.readUInt32LE(UNPACKED_SIZE_FIELD);
	const packed = stored !== 0;
	const storedSize = packed ? stored : unpacked;
	const payloadOffset = offset + BigInt(SIZE_PAIR);
	if (payloadOffset + BigInt(storedSize) > archiveSize) return undefined;
	return createFixedEntry({
		id,
		path: "",
		offset: payloadOffset,
		size: packed ? BigInt(unpacked) : BigInt(storedSize),
		packedSize: BigInt(storedSize),
		compressed: packed,
		metadata: { storedSize, unpackedSize: unpacked },
	});
}

export interface ShsSection {
	readonly offset: number;
	readonly size: number;
}

/**
 * GARBro `Him5Opener.ReadIndex`: section descriptors of a size and an offset, where a zero size marks an
 * absent section. The DDSystem format reads its sections through the same helper.
 */
export function readShsSections(index: Buffer, count: number): ShsSection[] {
	const sections: ShsSection[] = [];
	for (let id = 0; id < count; id += 1) {
		const size = index.readInt32LE(id * SECTION_RECORD_SIZE);
		const offset = index.readInt32LE(id * SECTION_RECORD_SIZE + WORD_SIZE);
		if (size !== 0) sections.push({ offset, size });
	}
	return sections;
}

/**
 * GARBro `Him4Opener.TryOpen`. Two signatures share the layout: the count sits at 4, the first entry's offset
 * at 8, and the index behind the header holds only the *later* offsets. A record's offset is therefore the
 * word before it, every size is the gap to the next offset, and the last entry runs to the end of the file.
 *
 * The reference reads one word past the last record while walking; the port stops one short, which yields the
 * same values because that word is never used. Entries carry generated five-digit names.
 */
async function readHim4Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HIM4_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, HIM4_INDEX_OFFSET);
	if (!HIM4_SIGNATURES.some((bytes) => header.subarray(0, 4).equals(bytes)))
		return undefined;
	const count = header.readInt32LE(HIM4_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * WORD_SIZE;
	if (BigInt(HIM4_INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(HIM4_INDEX_OFFSET), indexSize);

	const entries: FixedEntry[] = [];
	let offset = BigInt(header.readUInt32LE(HIM4_FIRST_OFFSET_FIELD));
	for (let id = 0; id < count; id += 1) {
		if (offset > source.size) return undefined;
		const entry = await buildShsEntry(source, id, offset, source.size);
		if (!entry) return undefined;
		entry.path = String(id).padStart(GENERATED_NAME_DIGITS, "0");
		entries.push(entry);
		offset =
			id + 1 === count
				? source.size
				: BigInt(index.readUInt32LE(id * WORD_SIZE));
	}
	return entries;
}

/**
 * GARBro `Him5Opener.TryOpen`. The count sits at 4 and eight-byte section descriptors follow at 8, each holding
 * a size and an offset; a descriptor with a zero size is skipped rather than walked. Inside a section entries
 * are read until its size runs out: a one-byte length below five ends the walk, and each entry then holds a
 * *big-endian* data offset and a name filling the rest of the record.
 *
 * Names come from the archive here rather than being generated, and the reference does not reject a blank one,
 * while the port does as it does elsewhere. The size pair behind every entry is read exactly as in version
 * four, so both versions share that step and the compression codec.
 */
async function readHim5Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(HIM5_SECTION_INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, HIM5_SECTION_INDEX_OFFSET);
	if (!HIM5_SIGNATURES.some((bytes) => header.subarray(0, 4).equals(bytes)))
		return undefined;
	const count = header.readInt32LE(HIM5_COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * SECTION_RECORD_SIZE;
	if (BigInt(HIM5_SECTION_INDEX_OFFSET + indexSize) > source.size)
		return undefined;
	const index = await source.readAt(
		BigInt(HIM5_SECTION_INDEX_OFFSET),
		indexSize,
	);

	const entries: FixedEntry[] = [];
	for (const section of readShsSections(index, count)) {
		if (section.offset < 0) return undefined;
		let position = section.offset;
		let remaining = section.size;
		while (remaining > 0) {
			if (BigInt(position) + 1n > source.size) return undefined;
			const lengthField = await source.readAt(BigInt(position), 1);
			const entrySize = lengthField.readUInt8(0);
			if (entrySize < MINIMUM_ENTRY_SIZE) break;
			if (BigInt(position + entrySize) > source.size) return undefined;
			const body = await source.readAt(BigInt(position), entrySize);
			const offset = BigInt(body.readUInt32BE(SECTION_ENTRY_OFFSET_FIELD));
			if (offset > source.size) return undefined;
			const nameField = body.subarray(SECTION_ENTRY_NAME_OFFSET);
			const terminator = nameField.indexOf(0);
			const name = decodeCp932(
				terminator === -1 ? nameField : nameField.subarray(0, terminator),
			);
			if (name.length === 0) return undefined;
			const entry = await buildShsEntry(
				source,
				entries.length,
				offset,
				source.size,
			);
			if (!entry) return undefined;
			Object.assign(entry, normalizeEntryPath(name));
			entries.push(entry);
			position += entrySize;
			remaining -= entrySize;
		}
	}
	return entries;
}

/** GARBro `Him4Opener.OpenEntry`: compressed payloads are expanded with the SH System codec. */
async function openHimEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (!entry.compressed) return Readable.from([stored]);
	return Readable.from([decompressShs(stored, Number(entry.size))]);
}

export const him4Format: ArchiveFormat = defineFixedArchive({
	descriptor: him4Descriptor,
	detection: { signatures: HIM4_SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readHim4Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readHim4Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SH System HIM4 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openHimEntry,
});

export const him5Format: ArchiveFormat = defineFixedArchive({
	descriptor: him5Descriptor,
	detection: { signatures: HIM5_SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readHim5Index(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readHim5Index(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid SH System HIM5 layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openHimEntry,
});
