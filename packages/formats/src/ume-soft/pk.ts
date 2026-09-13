// Format reference: GARBro ArcFormats/UMeSoft/ArcPK.cs, class `PkOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

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
	sourceExtension,
	type FixedEntry,
	type FixedEntryOpener,
} from "../shared/fixed-archive.js";

/** The reference registers these extensions, but detection is purely structural. */
export const PK_EXTENSIONS = [
	"pk",
	"gpk",
	"tpk",
	"wpk",
	"mpk",
	"pk0",
	"pka",
	"pkb",
	"pkc",
	"pkd",
	"pke",
	"pkf",
] as const;
const TRAILER_SIZE = 4;
/** `[length][name][six bytes][size][offset]` — the length byte is not part of this figure. */
const RECORD_OVERHEAD = 14;
const SIZE_FIELD_OFFSET = 7;
const NAME_LENGTH_SIZE = 1;
/** Only scripts and tables are compressed; the reference checks the entry extension. */
const PACKED_EXTENSIONS = ["scr", "tbl"];
const PACKED_PREFIX_SIZE = 4;
const XOR_KEY = 0x42;
const CONTROL_START = 0x80;

/**
 * GARbro `PkOpener.LzUnpack`. Control bits are read least-significant first from a byte that is
 * refilled with a fresh control value: a clear bit emits one literal, while a set bit reads two bytes
 * whose high nibble pair forms the distance and whose low nibble plus three forms the length. A
 * distance of zero ends the stream early, and copies expand into the output buffer the same way the
 * reference's overlapped copy does.
 */
export function unpackUmePkEntry(input: Buffer, outputSize: number): Buffer {
	const output = Buffer.alloc(outputSize);
	let control = 0;
	let mask = 0;
	let source = 0;
	let destination = 0;
	while (destination < outputSize) {
		mask >>= 1;
		if (mask === 0) {
			if (source >= input.length) break;
			control = input[source++] ?? 0;
			mask = CONTROL_START;
		}
		if ((control & mask) === 0) {
			output[destination++] = (input[source++] ?? 0) & 0xff;
		} else {
			if (source + 1 >= input.length) break;
			const low = input[source++] ?? 0;
			const high = input[source++] ?? 0;
			const offset = (high << 4) | (low >> 4);
			if (offset === 0) break;
			const count = (low & 0x0f) + 3;
			const from = destination - offset;
			for (let index = 0; index < count; index += 1) {
				if (from + index < 0)
					throw new GarbroError(
						"INVALID_ARCHIVE",
						"Invalid UMeSoft back reference",
					);
				if (destination >= output.length)
					throw new GarbroError("INVALID_ARCHIVE", "Truncated UMeSoft match");
				output[destination++] = output[from + index] ?? 0;
			}
		}
	}
	return output;
}

/**
 * GARbro `PkOpener.TryOpen`. There is no signature: the last four bytes of the file hold the index
 * size, and the index sits directly in front of that trailer. Records are read until a zero length
 * byte terminates the list and consist of a one-byte name length, the CP932 name, six bytes the
 * reference skips, and the stored size and payload offset.
 *
 * The reference checks each payload against the position of its own size field rather than the end of
 * the file, which is how it requires payloads to live before the index. It also rejects names whose
 * decoded length is implausibly short for their field, which rules out records padded with NUL bytes.
 */
async function readUmePkIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(TRAILER_SIZE * 2)) return undefined;
	const indexEnd = source.size - BigInt(TRAILER_SIZE);
	const indexSize = BigInt(
		(await source.readAt(indexEnd, TRAILER_SIZE)).readUInt32LE(0),
	);
	if (indexSize === 0n || indexSize >= indexEnd) return undefined;
	const indexOffset = indexEnd - indexSize;
	if (indexOffset < 0n || indexOffset + indexSize > source.size)
		return undefined;
	const index = await source.readAt(indexOffset, Number(indexSize));

	const entries: FixedEntry[] = [];
	let position = 0;
	while (position < index.length) {
		const record = position;
		const nameLength = index[record] ?? 0;
		if (nameLength === 0) break;
		// The whole record has to fit before the trailer.
		if (nameLength + RECORD_OVERHEAD > index.length - record - NAME_LENGTH_SIZE)
			return undefined;
		const name = decodeCp932(
			index.subarray(
				record + NAME_LENGTH_SIZE,
				record + NAME_LENGTH_SIZE + nameLength,
			),
		);
		if (name.length < Math.floor(nameLength / 2) + 1) return undefined;
		const sizePosition = record + nameLength + SIZE_FIELD_OFFSET;
		const storedSize = BigInt(index.readUInt32LE(sizePosition));
		const offset = BigInt(index.readUInt32LE(sizePosition + 4));
		if (!checkPlacement(offset, storedSize, indexOffset + BigInt(sizePosition)))
			return undefined;
		position = sizePosition + 8;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
			}),
		);
	}
	if (entries.length === 0) return undefined;

	// Scripts and tables keep a size-prefixed LZ stream behind an XOR key.
	for (const entry of entries) {
		if (
			!PACKED_EXTENSIONS.includes(sourceExtension(entry.rawPath ?? entry.path))
		)
			continue;
		if (entry.packedSize < BigInt(PACKED_PREFIX_SIZE)) continue;
		const outputSize = (
			await source.readAt(entry.offset, PACKED_PREFIX_SIZE)
		).readInt32LE(0);
		if (outputSize <= 0) continue;
		entry.offset += BigInt(PACKED_PREFIX_SIZE);
		entry.packedSize -= BigInt(PACKED_PREFIX_SIZE);
		entry.size = BigInt(outputSize);
		entry.compressed = true;
	}
	return entries;
}

/**
 * GARbro `PkOpener.OpenEntry`. Scripts and tables are decoded and then inverted byte by byte; every
 * other payload, and any packed-looking payload with a non-positive declared size, is emitted as a
 * plain byte range.
 */
const pkEntryOpener: FixedEntryOpener = async (source, entry) => {
	if (!entry.compressed)
		return source.createReadStream(entry.offset, entry.packedSize);
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	const decoded = unpackUmePkEntry(stored, Number(entry.size));
	for (let index = 0; index < decoded.length; index += 1)
		decoded[index] = (decoded[index] ?? 0) ^ XOR_KEY;
	return Readable.from([decoded]);
};

export const umeSoftPkDescriptor: FormatDescriptor = {
	id: "umesoft-pk",
	name: "U-Me Soft resources archive",
	extensions: [...PK_EXTENSIONS],
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
			source: "ArcFormats/UMeSoft/ArcPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const umeSoftPkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: umeSoftPkDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readUmePkIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readUmePkIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid UMeSoft PK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: pkEntryOpener,
});
