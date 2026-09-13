// Format reference: GARbro ArcFormats/RPM/ArcARC.cs (ArcIndexReader).
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import type { ByteSource } from "@garbro-mcp/core";
import { checkPlacement, decodeCStringField } from "../shared/fixed-archive.js";

/** GARbro `EncryptionScheme`: an ASCII keyword and the fixed width of one name field. */
export interface RpmEncryptionScheme {
	readonly keyword: string;
	readonly nameLength: number;
}

/** One decoded index record. `size` is the stored size, `unpackedSize` the declared output. */
export interface RpmIndexRecord {
	readonly name: string;
	readonly unpackedSize: bigint;
	readonly size: bigint;
	readonly offset: bigint;
}

/** Size of the three little-endian integers that follow a name field. */
const ENTRY_TAIL_SIZE = 12;

/**
 * GARbro `ArcIndexReader.DecryptIndex`: a repeating byte-wise addition over the whole index. The
 * keyword is ASCII, so the UTF-16 characters used by GARbro match the encoded bytes.
 */
export function decryptRpmIndex(index: Buffer, keyword: string): void {
	if (keyword.length === 0) return;
	for (let position = 0; position < index.length; position += 1) {
		index[position] =
			((index[position] ?? 0) + keyword.charCodeAt(position % keyword.length)) &
			0xff;
	}
}

/**
 * GARbro `ArcIndexReader.ReverseFind`: a backwards search for `pattern` whose end lies at or
 * before `position + pattern.Length - 1`. The skip-ahead branch is preserved verbatim.
 */
function reverseFind(array: Buffer, position: number, pattern: Buffer): number {
	const patternEnd = pattern.length - 1;
	let patternPosition = patternEnd;
	for (let index = position + patternPosition; index >= 0; index -= 1) {
		if (array[index] === pattern[patternPosition]) {
			if (patternPosition === 0) return index;
			patternPosition -= 1;
		} else if (patternEnd !== patternPosition) {
			index += patternEnd - patternPosition;
			patternPosition = patternEnd;
		}
	}
	return -1;
}

/**
 * GARbro `ArcIndexReader.GuessScheme`: recovers the repeating additive keyword from one entry
 * whose first offset is known from the index size. Returns `undefined` when no candidate name
 * width yields a printable keyword, which is also how GARbro rejects a false positive.
 */
export async function guessRpmScheme(
	source: ByteSource,
	count: number,
	indexOffset: number,
	possibleNameSizes: readonly number[],
): Promise<RpmEncryptionScheme | undefined> {
	const widest = possibleNameSizes[0];
	if (widest === undefined) return undefined;
	const probeSize = widest + ENTRY_TAIL_SIZE;
	if (BigInt(indexOffset + probeSize) > source.size) return undefined;
	const firstEntry = await source.readAt(BigInt(indexOffset), probeSize);
	const keyBits = Buffer.alloc(4);
	const actualOffset = Buffer.alloc(4);
	for (const nameLength of possibleNameSizes) {
		const firstOffset = indexOffset + count * (nameLength + ENTRY_TAIL_SIZE);
		if (BigInt(firstOffset) >= source.size) continue;
		actualOffset.writeUInt32LE(firstOffset, 0);
		for (let index = 0; index < 4; index += 1) {
			keyBits[index] =
				((firstEntry[nameLength + 8 + index] ?? 0) -
					(actualOffset[index] ?? 0)) &
				0xff;
		}
		const firstMatch = reverseFind(firstEntry, nameLength - 4, keyBits);
		if (firstMatch < 4) continue;
		const secondMatch = reverseFind(firstEntry, firstMatch - 4, keyBits);
		if (secondMatch <= 0) continue;
		const keyLength = firstMatch - secondMatch;
		const key = Buffer.alloc(keyLength);
		let index = 0;
		for (; index < keyLength; index += 1) {
			// GARbro negates the stored byte and keeps the result only when it is printable ASCII.
			const symbol = (0x100 - (firstEntry[secondMatch + index] ?? 0)) & 0xff;
			if (symbol < 0x21 || symbol > 0x7e) break;
			key[(secondMatch + index) % keyLength] = symbol;
		}
		if (index === keyLength)
			return { keyword: key.toString("latin1"), nameLength };
	}
	return undefined;
}

/**
 * GARbro `ArcIndexReader.ReadIndex`: decrypts the index, validates that the first entry starts
 * exactly behind it, and returns the raw records. Returns `undefined` where GARbro returns null.
 */
export async function readRpmIndex(
	source: ByteSource,
	count: number,
	indexOffset: number,
	scheme: RpmEncryptionScheme,
): Promise<RpmIndexRecord[] | undefined> {
	const indexSize = count * (scheme.nameLength + ENTRY_TAIL_SIZE);
	if (BigInt(indexOffset + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(indexOffset), indexSize);
	decryptRpmIndex(index, scheme.keyword);
	const dataOffset = BigInt(index.readUInt32LE(scheme.nameLength + 8));
	if (dataOffset !== BigInt(indexOffset + indexSize)) return undefined;

	const records: RpmIndexRecord[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		const name = decodeCStringField(index, position, scheme.nameLength);
		position += scheme.nameLength;
		const unpackedSize = BigInt(index.readUInt32LE(position));
		const size = BigInt(index.readUInt32LE(position + 4));
		const offset = BigInt(index.readUInt32LE(position + 8));
		if (size !== 0n) {
			if (offset < dataOffset || !checkPlacement(offset, size, source.size))
				return undefined;
		}
		records.push({ name, unpackedSize, size, offset });
		position += ENTRY_TAIL_SIZE;
	}
	return records;
}
