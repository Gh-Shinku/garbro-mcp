// Format reference: GARBro ArcFormats/ScrPlayer/ArcPAK.cs, class `PakOpener`.
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
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURES = [Buffer.from("pack", "ascii"), Buffer.from("pac2", "ascii")];
const ENCRYPTED_SIGNATURE_BYTE = 3;
const ENCRYPTED_MARKER = 0x32;
const INDEX_SIZE_OFFSET = 4;
const MIN_INDEX_SIZE = 0x10;
const INDEX_OFFSET = 8;
/** Header words of a record: offset, size and a name length byte. */
const RECORD_HEADER_SIZE = 9;
const RECORD_TAIL_SIZE = 8;
/** The index cipher works on 32-bit words with an eight-entry key. */
const WORD_SIZE = 4;
const KEY_MASK = 7;
const ENCRYPTION_KEY = new Uint32Array([
	0x305325a0, 0x306f308c, 0x672c5742, 0x5c0b5343, 0x8457306e, 0x72694f5c,
	0x30423067, 0x0000308b,
]);
/** Record alignment candidates, widest first. */
const ALIGNMENTS = [8, 4] as const;

export const scrPlayerPakDescriptor: FormatDescriptor = {
	id: "scrplayer-pak",
	name: "ScrPlayer engine resource archive",
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
			source: "ArcFormats/ScrPlayer/ArcPAK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/** GARBro `DecryptIndex`: each 32-bit word is exclusive-ored with a repeating eight-entry key. */
export function decryptScrPlayerIndex(data: Buffer): Buffer {
	const output = Buffer.from(data);
	const words = Math.trunc(output.length / WORD_SIZE);
	for (let index = 0; index < words; index += 1) {
		const position = index * WORD_SIZE;
		output.writeUInt32LE(
			(output.readUInt32LE(position) ^
				(ENCRYPTION_KEY[index & KEY_MASK] ?? 0)) >>>
				0,
			position,
		);
	}
	return output;
}

/** The inverse of `decryptScrPlayerIndex`, which the same XOR makes identical. */
export const encryptScrPlayerIndex = decryptScrPlayerIndex;

/**
 * GARBro `PakOpener.TestAlign`. The first record's offset and size predict where the second record must
 * start once its span is rounded up to eight bytes, and the candidate alignment is confirmed when the word
 * at the position the record layout implies holds exactly that value.
 */
function testAlign(index: Buffer, align: number): boolean {
	if (index.length < RECORD_HEADER_SIZE) return false;
	const firstOffset = index.readInt32LE(0);
	const size = index.readInt32LE(4);
	const nameLength = index.readUInt8(8);
	const secondOffset = (firstOffset + size + 7) & -8;
	const position = ((align + 1 + nameLength) & -align) + RECORD_TAIL_SIZE;
	if (position + WORD_SIZE > index.length) return false;
	return index.readInt32LE(position) === secondOffset;
}

/**
 * GARBro `PakOpener.ReadIndex`. A record holds the data offset, the size and a name length byte, and the
 * name follows that byte; the next record starts at the name length rounded down to the alignment, plus
 * eight. An offset word of zero ends the index, which is how the reference stops before the payloads.
 */
function readEntries(
	index: Buffer,
	align: number,
	archiveSize: bigint,
): FixedEntry[] | undefined {
	const entries: FixedEntry[] = [];
	let position = 0;
	while (position < index.length) {
		if (position + RECORD_HEADER_SIZE > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(position));
		if (offset === 0n) break;
		const size = BigInt(index.readUInt32LE(position + 4));
		const nameLength = index.readUInt8(position + 8);
		const nameStart = position + RECORD_HEADER_SIZE;
		if (nameStart + nameLength > index.length) return undefined;
		const field = index.subarray(nameStart, nameStart + nameLength);
		const terminator = field.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? field : field.subarray(0, terminator),
		);
		if (name.length === 0) return undefined;
		position += ((align + 1 + nameLength) & -align) + RECORD_TAIL_SIZE;
		if (!checkPlacement(offset, size, archiveSize)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
			}),
		);
	}
	return entries;
}

/**
 * GARBro `PakOpener.TryOpen`. Two signatures share the layout, and the third byte of the second one also
 * marks the index as encrypted: the reference then reads the index, rounds its buffer up to a whole number
 * of words and exclusive-ors each word with a repeating eight-entry key. Its cipher rejects a length that is
 * not a multiple of four, and the port rejects such an archive rather than throwing.
 *
 * The index follows the signature at 8 and its size sits at 4. A record's stride depends on whether the
 * records are aligned to eight bytes or four, which the reference infers by predicting where the second
 * record must begin; when the eight-byte reading fails it retries with four. Payloads are stored verbatim.
 */
async function readScrPlayerIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	const signature = SIGNATURES.find((bytes) =>
		header.subarray(0, 4).equals(bytes),
	);
	if (!signature) return undefined;
	const encrypted =
		(header[ENCRYPTED_SIGNATURE_BYTE] ?? 0) === ENCRYPTED_MARKER;
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_OFFSET));
	if (indexSize < BigInt(MIN_INDEX_SIZE) || indexSize >= source.size)
		return undefined;
	const raw = await source.readAt(BigInt(INDEX_OFFSET), Number(indexSize));
	let index = raw;
	if (encrypted) {
		if (indexSize % BigInt(WORD_SIZE) !== 0n) return undefined;
		index = decryptScrPlayerIndex(raw);
	}
	const align = testAlign(index, ALIGNMENTS[0]) ? ALIGNMENTS[0] : ALIGNMENTS[1];
	let entries = readEntries(index, align, source.size);
	if (!entries && align === ALIGNMENTS[0]) {
		entries = readEntries(index, ALIGNMENTS[1], source.size);
	}
	if (!entries || entries.length === 0) return undefined;
	return entries;
}

export const scrPlayerPakFormat: ArchiveFormat = defineFixedArchive({
	descriptor: scrPlayerPakDescriptor,
	detection: { signatures: SIGNATURES.map((bytes) => ({ bytes })) },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readScrPlayerIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readScrPlayerIndex(source);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid ScrPlayer PAK layout");
		return { entries, metadata: { entryCount: entries.length } };
	},
});
