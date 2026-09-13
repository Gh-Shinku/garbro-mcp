// Format reference: GARBro Legacy/WestGate/ArcUCA.cs, class `UcaTool`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { GarbroError, type ByteSource } from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** A record is a fixed name field followed by the offset word that belongs to the next entry. */
export const RECORD_SIZE = 0x10;
export const NAME_SIZE = 0xc;
/**
 * Characters GARbro rejects through `Path.GetInvalidFileNameChars`, which covers the control range and
 * the Windows set, including both separators.
 */
const INVALID_NAME_CHARS = new Set([
	'"',
	"<",
	">",
	"\\",
	"/",
	"|",
	":",
	"*",
	"?",
]);

function hasInvalidCharacter(name: string): boolean {
	for (const character of name) {
		if (character.charCodeAt(0) < 0x20) return true;
		if (INVALID_NAME_CHARS.has(character)) return true;
	}
	return false;
}

export interface WestGateIndexOptions {
	indexOffset: number;
	count: number;
	/** The type string GARbro assigns to every entry, exposed as metadata. */
	entryType: string;
}

/**
 * GARbro `UcaTool.ReadIndex`, shared by the UCA graphics and UWF audio archives. The index holds
 * 0x10-byte records of a 0xC-byte name field and an offset word, and each record's word is its own
 * entry's data offset. The first entry's start comes from the first word, and every entry is then
 * bounded by the following record's word, so its size is the gap to the next entry; the last entry runs
 * to the end of the file.
 *
 * Names may not repeat back to back, may not be blank, and may not contain any character GARbro
 * rejects as an invalid file name. Every bound must move strictly forward and stay inside the file.
 */
export async function readWestGateIndex(
	source: ByteSource,
	options: WestGateIndexOptions,
): Promise<FixedEntry[] | undefined> {
	const { indexOffset, count, entryType } = options;
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(indexOffset + count * RECORD_SIZE);
	if (BigInt(indexOffset + RECORD_SIZE * count) > source.size) return undefined;
	const index = await source.readAt(BigInt(indexOffset), RECORD_SIZE * count);

	let nextOffset = BigInt(index.readUInt32LE(NAME_SIZE));
	if (nextOffset < dataOffset) return undefined;
	const entries: FixedEntry[] = [];
	let previousName: string | undefined;
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		if (name.length === 0 || name.trim().length === 0) return undefined;
		if (name === previousName) return undefined;
		if (hasInvalidCharacter(name)) return undefined;
		previousName = name;

		const offset = nextOffset;
		nextOffset =
			id + 1 === count
				? source.size
				: BigInt(index.readUInt32LE(record + RECORD_SIZE + NAME_SIZE));
		if (nextOffset <= offset || nextOffset > source.size) return undefined;
		const size = nextOffset - offset;
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size,
				metadata: { inferredType: entryType },
			}),
		);
	}
	return entries;
}

/** Raised when a shared WestGate index cannot be read. */
export function westGateIndexError(tag: string): GarbroError {
	return new GarbroError("INVALID_ARCHIVE", `Invalid ${tag} index layout`);
}
