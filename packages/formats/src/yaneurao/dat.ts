// Format reference: GARBro Legacy/Yaneurao/ArcDAT.cs, classes `PackOpener` (DAT/yanepkDx) and
// `PackExOpener` (DAT/yanepkEx), which shares its opener with the base class.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import {
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
	GarbroError,
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

/** `0x0C09140A` little-endian: the marker of the original Yaneurao archives. */
const DX_MARKER = Buffer.from([0x0a, 0x14, 0x09, 0x0c]);
/** Both variants are recognized by their `yane` prefix. */
const YANE = Buffer.from("yane", "ascii");
const PK_DX = Buffer.from("pkDx", "ascii");
const PK_EX = Buffer.from("pkEx", "ascii");
/** `PackOpener` takes its count from the payload offset stored at 0x10C. */
const DX_COUNT_OFFSET = 0x10c;
const DX_MIN_FIRST_OFFSET = 0x118n;
/** `PackExOpener` stores the count at 0x08. */
const EX_COUNT_OFFSET = 0x08;
const INDEX_OFFSET = 0xc;
const DX_NAME_SIZE = 0x100;
const EX_NAME_SIZE = 0x20;
/** Every record is a name followed by offset, unpacked size and stored size. */
const RECORD_TAIL_SIZE = 12;

interface Variant {
	readonly nameSize: number;
	/** Record stride: the name field plus the three fields behind it. */
	readonly stride: number;
}

const DX_VARIANT: Variant = {
	nameSize: DX_NAME_SIZE,
	stride: DX_NAME_SIZE + RECORD_TAIL_SIZE,
};
const EX_VARIANT: Variant = {
	nameSize: EX_NAME_SIZE,
	stride: EX_NAME_SIZE + RECORD_TAIL_SIZE,
};

/**
 * GARbro's name fields come from `ArcView.ReadString`, which stops at the first null and clamps the
 * field to what the archive actually holds instead of failing.
 */
async function readNameField(
	source: ByteSource,
	offset: bigint,
	size: number,
): Promise<string> {
	if (offset >= source.size) return "";
	const available = Number(
		source.size - offset < BigInt(size) ? source.size - offset : BigInt(size),
	);
	const field = await source.readAt(offset, available);
	return decodeCStringField(field, 0, field.length);
}

/**
 * Reads an entry table from 0x0C. Each record holds a name, the payload offset, the unpacked size and
 * the stored size; a record counts as compressed exactly when those last two differ, which is how the
 * shared opener decides whether to unpack it with the default LZSS stream.
 */
async function readEntryTable(
	source: ByteSource,
	count: number,
	variant: Variant,
): Promise<FixedEntry[] | undefined> {
	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_OFFSET);
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + BigInt(variant.stride) > source.size) return undefined;
		const name = await readNameField(source, indexOffset, variant.nameSize);
		const tail = await source.readAt(
			indexOffset + BigInt(variant.nameSize),
			RECORD_TAIL_SIZE,
		);
		indexOffset += BigInt(variant.stride);
		const offset = BigInt(tail.readUInt32LE(0));
		const unpackedSize = BigInt(tail.readUInt32LE(4));
		const storedSize = BigInt(tail.readUInt32LE(8));
		const packed = storedSize !== unpackedSize;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: unpackedSize,
				packedSize: storedSize,
				compressed: packed,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

/**
 * GARbro `PackOpener.TryOpen`. The original variant stores the payload offset at 0x10C and derives the
 * count from it — the table runs from 0x0C, so the remainder between them is the table itself. Files
 * that begin with `yane` have to continue with `pkDx`; the earlier marker bytes stand alone.
 *
 * The count is a truncated division, exactly as in the reference, so a table that does not fill the
 * gap leaves its trailing bytes unread.
 */
async function readDxIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(DX_COUNT_OFFSET + 4)) return undefined;
	const signature = await source.readAt(0n, 4);
	const isYane = signature.equals(YANE);
	if (!isYane && !signature.equals(DX_MARKER)) return undefined;
	if (isYane) {
		const marker = await source.readAt(4n, 4);
		if (!marker.equals(PK_DX)) return undefined;
	}
	const header = await source.readAt(BigInt(DX_COUNT_OFFSET), 4);
	const firstOffset = BigInt(header.readUInt32LE(0));
	if (firstOffset < DX_MIN_FIRST_OFFSET || firstOffset >= source.size)
		return undefined;
	const count = Number(
		(firstOffset - BigInt(INDEX_OFFSET)) / BigInt(DX_VARIANT.stride),
	);
	if (!isSaneCount(count)) return undefined;
	return readEntryTable(source, count, DX_VARIANT);
}

/** GARbro `PackExOpener.TryOpen`: a `yanepkEx` marker, the count at 0x08 and 0x20-byte names. */
async function readExIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(EX_COUNT_OFFSET + 4)) return undefined;
	const signature = await source.readAt(0n, 4);
	if (!signature.equals(YANE)) return undefined;
	const marker = await source.readAt(4n, 4);
	if (!marker.equals(PK_EX)) return undefined;
	const header = await source.readAt(BigInt(EX_COUNT_OFFSET), 4);
	const count = header.readInt32LE(0);
	if (!isSaneCount(count)) return undefined;
	return readEntryTable(source, count, EX_VARIANT);
}

/** GARbro `PackOpener.OpenEntry`: stored ranges are handed out as is, packed ones run through LZSS. */
const yaneuraoEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const output = Buffer.alloc(Number(entry.size));
	const decoded = inflateLzssAll(stored, {
		maxOutputLength: output.length,
	});
	decoded.copy(output);
	return Readable.from([output]);
};

const attribution = {
	project: "GARbro",
	source: "Legacy/Yaneurao/ArcDAT.cs",
	license: "MIT",
	commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
} as const;

export const yaneuraoDatDxDescriptor: FormatDescriptor = {
	id: "yaneurao-dat-dx",
	name: "Yaneurao resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const yaneuraoDatExDescriptor: FormatDescriptor = {
	id: "yaneurao-dat-ex",
	name: "Yaneurao resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [attribution],
};

export const yaneuraoDatDxFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yaneuraoDatDxDescriptor,
	detection: { signatures: [{ bytes: YANE }, { bytes: DX_MARKER }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDxIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readDxIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid yanepkDx layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: yaneuraoEntryOpener,
});

export const yaneuraoDatExFormat: ArchiveFormat = defineFixedArchive({
	descriptor: yaneuraoDatExDescriptor,
	detection: { signatures: [{ bytes: YANE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readExIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readExIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid yanepkEx layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: yaneuraoEntryOpener,
});
