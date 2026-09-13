// Format reference: GARBro ArcFormats/Abel/ArcARC.cs, class `ArcOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
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

const SIGNATURE = Buffer.from("arc\0", "ascii");
const COUNT_FIELD = 8;
const BASE_OFFSET_FIELD = 0x0c;
const PACKED_SIZE_FIELD = 0x10;
const INDEX_SIZE_FIELD = 0x14;
/** The LZSS-compressed index follows the 0x18-byte header. */
const INDEX_OFFSET = 0x18;
/** A record is a 30-byte name followed by the payload offset and size. */
const INDEX_ENTRY_SIZE = 0x26;
const NAME_SIZE = 30;
const CMP_MARKER = Buffer.from("CMP\0", "ascii");
const ACD_MARKER = Buffer.from("ACD\0", "ascii");
/** The `CMP` container points at its payload with a word eight bytes in, behind a flag byte. */
const CMP_OFFSET_FIELD = 8;
const CMP_PACKED_SIZE_FIELD = 5;
const CMP_DATA_OFFSET = 0x11;
/** The `ACD` XOR cipher starts behind the marker and its first word. */
const ACD_PREFIX_SIZE = 8;

export const abelArcDescriptor: FormatDescriptor = {
	id: "abel-arc",
	name: "ADVEngine resource archive",
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
			source: "ArcFormats/Abel/ArcARC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARbro's `HasExtension` compares case-insensitively, including the leading dot. */
function hasExtension(name: string, extension: string): boolean {
	return name.toLowerCase().endsWith(extension);
}

/**
 * GARbro `ArcOpener.TryOpen`. The `arc\0` header holds the record count, the payload base offset, the
 * packed size of an LZSS-compressed index and that index's uncompressed size. The reference requires
 * the base offset past the header, the packed size inside the file and the uncompressed size to be
 * exactly `count * 0x26`, then reads 0x26-byte records: a 30-byte CP932 name, a payload offset
 * relative to the base and a size. Names ending in `.acd` are typed as scripts.
 */
async function readAbelIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const baseOffset = BigInt(header.readUInt32LE(BASE_OFFSET_FIELD));
	if (baseOffset <= BigInt(INDEX_OFFSET) || baseOffset >= source.size)
		return undefined;
	const packedSize = BigInt(header.readUInt32LE(PACKED_SIZE_FIELD));
	if (packedSize > source.size) return undefined;
	const indexSize = header.readInt32LE(INDEX_SIZE_FIELD);
	if (Math.trunc(indexSize / INDEX_ENTRY_SIZE) !== count) return undefined;

	const available = source.size - BigInt(INDEX_OFFSET);
	const storedLength = packedSize < available ? packedSize : available;
	const stored = await source.readAt(
		BigInt(INDEX_OFFSET),
		bigintToBufferLength(storedLength, "Abel ARC index"),
	);
	const index = inflateLzssAll(stored);
	if (index.length < count * INDEX_ENTRY_SIZE) return undefined;

	const entries: FixedEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const record = id * INDEX_ENTRY_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const offset = BigInt(index.readUInt32LE(record + NAME_SIZE)) + baseOffset;
		const size = BigInt(index.readUInt32LE(record + NAME_SIZE + 4));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				packedSize: size,
				...(hasExtension(name, ".acd") ? { metadata: { type: "script" } } : {}),
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARBro `ArcOpener.OpenEntry`. `.cmp` entries whose payload starts with the `CMP\0` marker keep a
 * payload offset and, when the byte at that offset is zero, an LZSS stream at offset 0x11 whose
 * packed size must equal the remaining entry size; any other `CMP` layout falls back to the raw
 * sub-range. `.acd` entries whose payload starts with `ACD\0` are XORed with 0xFF behind the first
 * eight bytes. Everything else is a plain byte range.
 */
const abelEntryOpener: FixedEntryOpener = async (source, entry) => {
	const name = entry.path;
	if (entry.size > 12n && hasExtension(name, ".cmp")) {
		const marker = await source.readAt(entry.offset, CMP_MARKER.length);
		if (marker.equals(CMP_MARKER)) {
			const cmpOffset = BigInt(
				(
					await source.readAt(entry.offset + BigInt(CMP_OFFSET_FIELD), 4)
				).readUInt32LE(0),
			);
			if (cmpOffset < entry.size) {
				const cmpStart = entry.offset + cmpOffset;
				const flag = (await source.readAt(cmpStart, 1))[0] ?? 0;
				if (flag === 0) {
					const packedSize = BigInt(
						(
							await source.readAt(cmpStart + BigInt(CMP_PACKED_SIZE_FIELD), 4)
						).readUInt32LE(0),
					);
					// The reference subtracts in 32-bit arithmetic, so an underflow wraps.
					const remaining = (entry.size - cmpOffset - 0x11n) & 0xffffffffn;
					if (packedSize === remaining) {
						const stored = await source.readAt(
							cmpStart + BigInt(CMP_DATA_OFFSET),
							bigintToBufferLength(packedSize, "Abel CMP entry"),
						);
						return Readable.from([inflateLzssAll(stored)]);
					}
				}
				return source.createReadStream(cmpStart, entry.size - cmpOffset);
			}
		}
	}
	if (entry.size > 8n && hasExtension(name, ".acd")) {
		const marker = await source.readAt(entry.offset, ACD_MARKER.length);
		if (marker.equals(ACD_MARKER)) {
			const data = Buffer.from(
				await source.readAt(
					entry.offset,
					bigintToBufferLength(entry.size, "Abel ACD entry"),
				),
			);
			for (let index = ACD_PREFIX_SIZE; index < data.length; index += 1)
				data[index] = 0xff - (data[index] ?? 0);
			return Readable.from([data]);
		}
	}
	return source.createReadStream(entry.offset, entry.size);
};

export const abelArcFormat: ArchiveFormat = defineFixedArchive({
	descriptor: abelArcDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAbelIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readAbelIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ADVEngine ARC layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: abelEntryOpener,
});
