// Format reference: GARBro ArcFormats/Ivory/ArcPK.cs, classes `PakOpener`, `PkEntry` and its
// `Decrypt` routine.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Both signatures share the `fPK` prefix, and the byte at 3 selects the version. */
const SIGNATURES = [
	Buffer.from([0x66, 0x50, 0x4b, 0x20]),
	Buffer.from([0x66, 0x50, 0x4b, 0x32]),
];
const VERSION_TWO_BYTE = 0x32;
const LENGTH_OFFSET = 4;
const VERSION_ONE_LONG_SIZE = 4;
const VERSION_TWO_LONG_SIZE = 8;
const SCHEDULE_SIZE = 32;
const SCHEDULE_STEPS = 16;
const WORD_SIZE = 4;
const LIST_SECTION = "cLST";
const NAME_SECTION = "cNAM";
const DATA_SECTION = "cDAT";
const SECTION_HEADER_FIELDS = 12;
const MIN_SECTION_SIZE = 4;
/** `cLST` skips one word, then holds the count and the key; `cNAM` skips one word before its key. */
const LIST_COUNT_TAIL = 4;
const LIST_KEY_TAIL = 8;
const NAME_KEY_TAIL = 4;

export const ivoryPkDescriptor: FormatDescriptor = {
	id: "ivory-pk",
	name: "Ivory resource archive",
	extensions: [],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: true,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/Ivory/ArcPK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function rotateLeft32(value: number, shift: number): number {
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

export interface IvorySchedule {
	readonly control: Uint16Array;
	readonly key: Uint32Array;
}

/**
 * GARBro `PakOpener.Decrypt`'s key schedule. Each of thirty-two entries mixes the seed sixteen times,
 * folding the word and its shifted copy into the high half of a sixteen-bit accumulator, then keeps the
 * seed that produced it before rotating that seed left by one.
 */
export function ivoryKeySchedule(seed: number): IvorySchedule {
	const control = new Uint16Array(SCHEDULE_SIZE);
	const key = new Uint32Array(SCHEDULE_SIZE);
	let current = seed >>> 0;
	for (let entry = 0; entry < SCHEDULE_SIZE; entry += 1) {
		let code = 0;
		let mixed = current;
		for (let step = 0; step < SCHEDULE_STEPS; step += 1) {
			const folded = (mixed ^ (mixed >>> 1)) >>> 0;
			code = ((folded << 15) | ((code & 0xffff) >>> 1)) & 0xffff;
			mixed = mixed >>> 2;
		}
		key[entry] = current;
		control[entry] = code;
		current = rotateLeft32(current, 1);
	}
	return { control, key };
}

/**
 * The bit permutation the cipher applies to every word. One control bit governs each two-bit field,
 * starting at the least significant pair: a clear bit copies the pair unchanged while a set bit swaps its
 * two bits. Swapping is its own inverse, so this routine serves both directions of the data half.
 */
export function permuteIvory(data: Buffer, schedule: IvorySchedule): Buffer {
	const output = Buffer.from(data);
	const words = Math.trunc(output.length / WORD_SIZE);
	for (let index = 0; index < words; index += 1) {
		const word = output.readUInt32LE(index * WORD_SIZE);
		let control = schedule.control[index & (SCHEDULE_SIZE - 1)] ?? 0;
		let result = 0;
		let pair = 3;
		let high = 2;
		let low = 1;
		for (let step = 0; step < SCHEDULE_STEPS; step += 1) {
			result =
				(control & 1) !== 0
					? (result | ((word & low) << 1) | ((word >>> 1) & (high >>> 1))) >>> 0
					: (result | (word & pair)) >>> 0;
			control >>= 1;
			pair = (pair << 2) >>> 0;
			high = (high << 2) >>> 0;
			low = (low << 2) >>> 0;
		}
		output.writeUInt32LE(result, index * WORD_SIZE);
	}
	return output;
}

/**
 * GARBro `PakOpener.Decrypt`. Every full 32-bit word is permuted and then exclusive-ored with its
 * scheduled key word; a trailing partial word is left alone because the reference only walks whole words.
 */
export function decryptIvory(data: Buffer, seed: number): Buffer {
	const schedule = ivoryKeySchedule(seed);
	const output = permuteIvory(data, schedule);
	const words = Math.trunc(output.length / WORD_SIZE);
	for (let index = 0; index < words; index += 1) {
		const position = index * WORD_SIZE;
		output.writeUInt32LE(
			(output.readUInt32LE(position) ^
				(schedule.key[index & (SCHEDULE_SIZE - 1)] ?? 0)) >>>
				0,
			position,
		);
	}
	return output;
}

/**
 * GARBro `PakOpener.TryOpen`. The head is `fPK ` or `fPK2`; the byte at 3 picks the version, which sets
 * whether section lengths and record fields are 32-bit words or 64-bit longs, and the value at 4 must
 * equal the file's own size. Sections follow one another from behind that length.
 *
 * A section holds a four-byte identifier, its size, and a header size that places its content, and the
 * fields a section needs beyond those three are read from the stream *behind* the header fields, so each
 * one sits a further `2 * long_size` bytes in. `cLST` announces a record count and a key and its
 * decrypted content is that many triples of a name offset, a data offset and a size. `cNAM` holds a
 * decrypted name pool and requires the list to have been seen. `cDAT` only records where its content
 * starts, which becomes the base offset added to every entry offset. Payloads are stored verbatim and
 * `*.px` entries are classified as audio.
 */
async function readIvoryIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(LENGTH_OFFSET + VERSION_TWO_LONG_SIZE))
		return undefined;
	const probe = await source.readAt(0n, 4);
	const signature = SIGNATURES.find((bytes) => probe.equals(bytes));
	if (!signature) return undefined;
	const longSize =
		signature[3] === VERSION_TWO_BYTE
			? VERSION_TWO_LONG_SIZE
			: VERSION_ONE_LONG_SIZE;
	const data = await source.readAt(0n, Number(source.size));
	const readLong = (position: number): bigint =>
		longSize === VERSION_TWO_LONG_SIZE
			? data.readBigInt64LE(position)
			: BigInt(data.readUInt32LE(position));
	if (readLong(LENGTH_OFFSET) !== source.size) return undefined;

	let position = LENGTH_OFFSET + longSize;
	let records:
		| { nameOffset: bigint; offset: bigint; size: bigint }[]
		| undefined;
	let names: Buffer | undefined;
	let baseOffset = 0n;
	while (position + SECTION_HEADER_FIELDS <= data.length) {
		const sectionStart = position;
		const id = data.toString("latin1", sectionStart, sectionStart + 4);
		const sectionSize = readLong(sectionStart + 4);
		// The header size follows the section size, so it sits a whole long behind it.
		const headerSize = readLong(sectionStart + 4 + longSize);
		if (sectionSize < BigInt(MIN_SECTION_SIZE) || headerSize > sectionSize)
			return undefined;
		const contentPosition = BigInt(sectionStart) + headerSize;
		const contentSize = sectionSize - headerSize;
		const contentEnd = contentPosition + contentSize;
		if (contentEnd > BigInt(data.length)) return undefined;
		// Behind the three header fields the stream reads a word and then the section's own fields, so
		// those sit `2 * long_size` bytes further in than the identifier does.
		const fields = sectionStart + 4 + longSize * 2;
		const content = (): Buffer =>
			Buffer.from(data.subarray(Number(contentPosition), Number(contentEnd)));

		if (id === LIST_SECTION) {
			const count = data.readInt32LE(fields + LIST_COUNT_TAIL);
			if (!isSaneCount(count)) return undefined;
			const recordSize = longSize * 3;
			if (count * recordSize > Number(contentSize)) return undefined;
			const decrypted = decryptIvory(
				content(),
				data.readUInt32LE(fields + LIST_KEY_TAIL),
			);
			records = [];
			for (let index = 0; index < count; index += 1) {
				const base = index * recordSize;
				const read = (offset: number): bigint =>
					longSize === VERSION_TWO_LONG_SIZE
						? decrypted.readBigInt64LE(base + offset)
						: BigInt(decrypted.readUInt32LE(base + offset));
				records.push({
					nameOffset: read(0),
					offset: read(longSize),
					size: read(longSize * 2),
				});
			}
		} else if (id === NAME_SECTION) {
			if (records === undefined) return undefined;
			names = decryptIvory(
				content(),
				data.readUInt32LE(fields + NAME_KEY_TAIL),
			);
		} else if (id === DATA_SECTION) {
			baseOffset = contentPosition;
		}
		position = Number(BigInt(sectionStart) + sectionSize);
	}
	if (records === undefined || names === undefined || baseOffset === 0n)
		return undefined;

	const entries: FixedEntry[] = [];
	for (const record of records) {
		const offset = record.offset + baseOffset;
		if (!checkPlacement(offset, record.size, source.size)) return undefined;
		const nameOffset = Number(record.nameOffset);
		if (nameOffset < 0 || nameOffset >= names.length) return undefined;
		const terminator = names.indexOf(0, nameOffset);
		const name = decodeCp932(
			names.subarray(nameOffset, terminator === -1 ? names.length : terminator),
		);
		if (name.length === 0) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size: record.size,
				...(sourceExtension(name) === "px"
					? { metadata: { inferredType: "audio" } }
					: {}),
			}),
		);
	}
	return entries;
}

export const ivoryPkFormat: ArchiveFormat = defineFixedArchive({
	descriptor: ivoryPkDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readIvoryIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readIvoryIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Ivory PK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
