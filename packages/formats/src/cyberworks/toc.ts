// Format reference: GARBro ArcFormats/Cyberworks/ArcDAT.cs — classes `TocUnpacker` and `IndexReader`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzssAll } from "@garbro-mcp/codecs";
import type { ByteSource } from "@garbro-mcp/core";
import { changeExtension } from "../shared/companion.js";
import {
	checkPlacement,
	createFixedEntry,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** A table of contents may not claim more than this many unpacked bytes. */
const MAX_UNPACKED_SIZE = 0x1000000;
/** A record must hold its own fields and at least one type byte. */
export const MIN_ENTRY_SIZE = 0x11;
/** The reference numbers unnamed records from this value upwards. */
const FAULT_ID_BASE = 100000;

/**
 * GARBro `TocUnpacker.DecodeDecimal`. A decimal field stores one digit per byte as the byte exclusive-ored
 * with 0x7F, most significant digit first, and 0xFF marks a digit that is treated as absent.
 */
export function decodeDecimal(
	data: Buffer,
	offset: number,
	length: number,
): number {
	let value = 0;
	let rank = 1;
	for (let i = length - 1; i >= 0; i -= 1, rank *= 10) {
		const byte = data[offset + i] ?? 0xff;
		if (byte !== 0xff) value += (byte ^ 0x7f) * rank;
	}
	return value;
}

export interface TocResult {
	toc: Buffer;
	packedSize: number;
	unpackedSize: number;
}

/**
 * GARBro `TocUnpacker.Unpack`. Two decimal fields of `numLength` digits each open the table: the unpacked size,
 * which must be larger than four and at most 0x1000000, and the packed size, which must be non-zero and fit
 * behind the fields. The LZSS stream that follows unpacks into the declared size.
 */
export async function unpackToc(
	source: ByteSource,
	offset: number,
	numLength: number,
): Promise<TocResult | undefined> {
	const dataOffset = BigInt(offset + numLength * 2);
	if (source.size <= dataOffset) return undefined;
	const header = await source.readAt(BigInt(offset), numLength * 2);
	const unpackedSize = decodeDecimal(header, 0, numLength);
	if (unpackedSize <= 4 || unpackedSize > MAX_UNPACKED_SIZE) return undefined;
	const packedSize = decodeDecimal(header, numLength, numLength);
	if (packedSize === 0) return undefined;
	if (BigInt(packedSize) > source.size - dataOffset) return undefined;
	let decoded: Buffer;
	try {
		decoded = inflateLzssAll(
			Buffer.from(await source.readAt(dataOffset, packedSize)),
		);
	} catch {
		return undefined;
	}
	// The reference reads exactly the declared size, so a shorter stream declines the table.
	if (decoded.length < unpackedSize) return undefined;
	return {
		toc: decoded.subarray(0, unpackedSize),
		packedSize,
		unpackedSize,
	};
}

/** What a concrete reader makes of one record's type bytes. */
export interface TocTypeOutcome {
	/** Reject the record, which the archive reader uses to select one archive out of many. */
	skip?: boolean;
	/** Reject the whole table, which a reader does when a record size disagrees with its layout. */
	reject?: boolean;
	/** Extension the record's numeric name is completed with. */
	extension?: string;
	/** Entry type the record declares. */
	type?: string;
	/** Whether the record holds an image, which decides the archive's image handling. */
	image?: boolean;
	/** Amount the record's payload offset is rebased by. */
	offsetDelta?: bigint;
}

export type TocTypeReader = (
	index: Buffer,
	position: number,
	entrySize: number,
) => TocTypeOutcome;

export interface TocIndex {
	entries: FixedEntry[];
	hasImages: boolean;
}

/**
 * GARBro `IndexReader.Read`. The first record's size divides the table into an estimated record count, and the
 * walk then follows each record's own size word: a record carries an identifier, unpacked and stored sizes and a
 * payload offset, followed by type bytes the concrete reader interprets. A record whose payload does not fit the
 * archive is skipped rather than declining the table.
 */
export function readTocIndex(
	index: Buffer,
	maxOffset: bigint,
	readType: TocTypeReader,
): TocIndex | undefined {
	if (index.length < 4) return undefined;
	const firstSize = index.readInt32LE(0);
	if (firstSize < MIN_ENTRY_SIZE) return undefined;
	if (!isSaneCount(Math.floor(index.length / (firstSize + 4))))
		return undefined;

	const entries: FixedEntry[] = [];
	let hasImages = false;
	let faultId = FAULT_ID_BASE;
	let position = 0;
	while (position < index.length) {
		if (position + 4 > index.length) return undefined;
		const entrySize = index.readInt32LE(position);
		if (entrySize <= 0) return undefined;
		const infoPosition = position + 4;
		if (infoPosition + 16 > index.length) return undefined;
		const rawId = index.readUInt32LE(infoPosition);
		const id = rawId > faultId ? faultId++ : rawId;
		const unpackedSize = BigInt(index.readUInt32LE(infoPosition + 4));
		const storedSize = BigInt(index.readUInt32LE(infoPosition + 8));
		const offset = BigInt(index.readUInt32LE(infoPosition + 12));
		const outcome = readType(index, infoPosition + 16, entrySize);
		position += 4 + entrySize;
		if (outcome.reject === true) return undefined;
		if (outcome.skip === true) continue;
		// The reference marks the archive while it reads a type, before it checks placement.
		if (outcome.image === true) hasImages = true;
		const rebased = offset + (outcome.offsetDelta ?? 0n);
		if (!checkPlacement(rebased, storedSize, maxOffset)) continue;
		const packed = unpackedSize !== storedSize;
		let name = String(id).padStart(6, "0");
		if (outcome.extension !== undefined)
			name = changeExtension(name, outcome.extension);
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: name,
				offset: rebased,
				size: packed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed: packed,
				...(outcome.type === undefined
					? {}
					: { metadata: { type: outcome.type } }),
			}),
		);
	}
	return { entries, hasImages };
}
