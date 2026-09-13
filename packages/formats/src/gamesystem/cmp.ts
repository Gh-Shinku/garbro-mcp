// Format reference: GARBro ArcFormats/GameSystem/ArcCMP.cs, class `CmpOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** The trailer is two words at the very end of the file: the index offset and the signature. */
const TRAILER_SIZE = 8;
const SIGNATURE_FIELD = 4;
const SIGNATURE = 0x4b434150; // 'PACK'
/** A record starts with the name length, a packed flag and four unused bytes. */
const RECORD_HEADER_SIZE = 6;

interface CmpMetadata extends Record<string, unknown> {
	packed: boolean;
	unpackedSize: number;
}

function cmpMetadata(entry: FixedEntry): CmpMetadata {
	const metadata = entry.metadata ?? {};
	return {
		packed: metadata.packed === true,
		unpackedSize: Number(metadata.unpackedSize ?? 0),
	};
}

/**
 * GARBro `CmpOpener.LzUnpack`. A control byte with its top bit set introduces a match: the next byte and the
 * control byte form a little-endian half-word whose low eleven bits are the distance minus one and whose bits
 * eleven and up are half the run length minus one. Otherwise the control byte counts the literal bytes that
 * follow, minus one. The decoder runs until the declared output is full, so no end marker is needed.
 */
function unpackCmp(input: Buffer, outputLength: number): Buffer {
	const output = Buffer.alloc(outputLength);
	let source = 0;
	let destination = 0;
	while (destination < outputLength) {
		if (source >= input.length)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Truncated GameSystem CMP index",
			);
		const control = input[source] ?? 0;
		source += 1;
		if ((control & 0x80) !== 0) {
			if (source >= input.length)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Truncated GameSystem CMP index",
				);
			const num = (input[source] ?? 0) + (control << 8);
			source += 1;
			const offset = num & 0x7ff;
			const count = Math.min(
				((num >> 10) & 0x1e) + 2,
				outputLength - destination,
			);
			const start = destination - offset - 1;
			if (start < 0)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"GameSystem CMP match precedes the decoded index",
				);
			for (let i = 0; i < count; i += 1)
				output[destination + i] = output[start + i] ?? 0;
			destination += count;
		} else {
			const count = Math.min(control + 1, outputLength - destination);
			if (source + count > input.length)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"Truncated GameSystem CMP index",
				);
			input.copy(output, destination, source, source + count);
			source += count;
			destination += count;
		}
	}
	return output;
}

/**
 * GARBro `CmpOpener.ReadIndex`. The index is an LZ stream in front of the trailer that unpacks to a record
 * list. Each record is a 16-bit name length, a packed flag, four unused bytes, a UTF-16 name and the next
 * record's payload offset; a zero name length ends the walk early, and an entry's stored size is the gap to
 * the next offset. Payloads must lie before the index.
 */
async function readCmp(
	source: ByteSource,
): Promise<
	{ entries: FixedEntry[]; indexOffset: number; indexSize: number } | undefined
> {
	if (source.size <= BigInt(TRAILER_SIZE)) return undefined;
	const trailer = await source.readAt(
		source.size - BigInt(TRAILER_SIZE),
		TRAILER_SIZE,
	);
	if (trailer.readUInt32LE(SIGNATURE_FIELD) !== SIGNATURE) return undefined;
	const indexOffset = Number(trailer.readUInt32LE(0));
	if (BigInt(indexOffset) >= source.size) return undefined;
	if (BigInt(indexOffset) + 4n > source.size) return undefined;
	const indexSize = (await source.readAt(BigInt(indexOffset), 4)).readInt32LE(
		0,
	);
	if (indexSize < 4 || !isSaneCount(indexSize)) return undefined;
	const unpacked = unpackCmp(
		Buffer.from(
			await source.readAt(
				BigInt(indexOffset + 4),
				Number(source.size) - indexOffset - 4,
			),
		),
		indexSize,
	);

	const entries: FixedEntry[] = [];
	let cursor = 0;
	let offset = BigInt(unpacked.readUInt32LE(0));
	while (cursor < unpacked.length) {
		cursor += 4;
		// A zero name length ends the walk; anything else needs the packed flag behind it.
		if (cursor >= unpacked.length) return undefined;
		const nameLength = unpacked[cursor] ?? 0;
		if (nameLength === 0) break;
		if (cursor + 1 >= unpacked.length) return undefined;
		const packed = (unpacked[cursor + 1] ?? 0) !== 0;
		cursor += RECORD_HEADER_SIZE;
		const byteLength = nameLength * 2;
		if (cursor + byteLength + 4 > unpacked.length) return undefined;
		const name = unpacked
			.subarray(cursor, cursor + byteLength)
			.toString("utf16le");
		cursor += byteLength;
		const nextOffset = BigInt(unpacked.readUInt32LE(cursor));
		// The stored size is an unsigned 32-bit difference, exactly like the reference's subtraction.
		const storedSize = (nextOffset - offset) & 0xffffffffn;
		const entry = createFixedEntry({
			id: entries.length,
			...normalizeEntryPath(name),
			offset,
			size: storedSize,
			packedSize: storedSize,
		});
		if (!checkPlacement(entry.offset, entry.packedSize, BigInt(indexOffset)))
			return undefined;
		if (packed) {
			// The unpacked size is the first word of the payload, which the reference resolves on open.
			if (entry.packedSize < 4n) return undefined;
			const prefix = await source.readAt(entry.offset, 4);
			const unpackedSize = prefix.readUInt32LE(0);
			entry.compressed = true;
			entry.metadata = { packed: true, unpackedSize } satisfies CmpMetadata;
			entry.size = BigInt(unpackedSize);
		} else {
			entry.metadata = {
				packed: false,
				unpackedSize: Number(storedSize),
			} satisfies CmpMetadata;
		}
		entries.push(entry);
		offset = nextOffset;
	}
	return { entries, indexOffset, indexSize };
}

class CmpArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = gamesystemCmpDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: FixedEntry[],
		indexOffset: number,
		indexSize: number,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = {
			entryCount: entries.length,
			indexOffset,
			indexSize,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const metadata = cmpMetadata(entry);
		if (!metadata.packed)
			return this.#source.createReadStream(entry.offset, entry.packedSize);
		const stream = Buffer.from(
			await this.#source.readAt(
				entry.offset + 4n,
				Number(entry.packedSize) - 4,
			),
		);
		return Readable.from([unpackCmp(stream, metadata.unpackedSize)]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const gamesystemCmpDescriptor: FormatDescriptor = {
	id: "gamesystem-cmp",
	name: "'GameSystem' engine resource archive",
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
			source: "ArcFormats/GameSystem/ArcCMP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const gamesystemCmpFormat: ArchiveFormat = {
	descriptor: gamesystemCmpDescriptor,
	// The signature lives in the trailer, so the head-based signature list stays empty.
	detection: { signatures: [] },
	async detect(source: ByteSource, _sourcePath: string): Promise<boolean> {
		try {
			const index = await readCmp(source);
			return index !== undefined && index.entries.length > 0;
		} catch {
			// A truncated or malformed index simply means this is not a CMP archive.
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readCmp(source);
		if (!index || index.entries.length === 0)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GameSystem CMP layout");
		return new CmpArchiveHandle(
			source,
			sourcePath,
			index.entries,
			index.indexOffset,
			index.indexSize,
		);
	},
};
