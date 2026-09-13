// Format reference: GARBro ArcFormats/CatSystem/ArcDAT.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("CsPack2", "ascii");
const DATA_OFFSET_OFFSET = 8;
const INDEX_OFFSET = 12;
const RECORD_SIZE = 24;
const NAME_LENGTH = 0x1e;
const DIGIT_BASE = 40;
const DIGITS_PER_WORD = 6;
const EXTENSION_OFFSET = 0x10;
const EXTENSION_LENGTH = 3;
/** GARbro's 38-character alphabet; a larger digit would index past it in the reference. */
const ALPHABET = "_0123456789abcdefghijklmnopqrstuvwxyz_";

export const csPackDescriptor: FormatDescriptor = {
	id: "cat-system-cspack",
	name: "Cat System resource archive",
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
			source: "ArcFormats/CatSystem/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `CsNameDecryptor`: the first twenty bytes of every record are base-40 digits, six per
 * 32-bit word, that fill a 30-character name field. The base name is the field up to a NUL, and when
 * character 0x10 is set the name gains a dot and three more characters.
 */
function decryptName(record: Buffer): string | undefined {
	const field = Buffer.alloc(NAME_LENGTH);
	const packedLength = Math.floor(NAME_LENGTH / DIGITS_PER_WORD) * 4;
	let destination = 0;
	for (let position = 0; position < packedLength; position += 4) {
		let value = record.readUInt32LE(position) >>> 0;
		for (let digit = DIGITS_PER_WORD - 1; digit >= 0; digit -= 1) {
			const symbol = value % DIGIT_BASE;
			value = Math.floor(value / DIGIT_BASE);
			if (symbol >= ALPHABET.length) return undefined;
			field[destination + digit] = symbol;
		}
		destination += DIGITS_PER_WORD;
	}
	const append = (offset: number, length: number): string => {
		let text = "";
		for (let index = 0; index < length; index += 1) {
			const symbol = field[offset + index] ?? 0;
			if (symbol === 0) break;
			text += ALPHABET[symbol];
		}
		return text;
	};
	let name = append(0, NAME_LENGTH - 4);
	if ((field[EXTENSION_OFFSET] ?? 0) !== 0)
		name += `.${append(EXTENSION_OFFSET, EXTENSION_LENGTH)}`;
	return name;
}

/**
 * GARBro `DatOpener.TryOpen`. A `CsPack2` header stores the data offset at 8 and records of 24 bytes
 * from 12. Every record carries encrypted name digits and, at +0x14, a word that GARbro XORs with the
 * two leading words to obtain the end of that entry, so sizes are derived from the chain.
 */
async function readCsPackIndex(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_OFFSET));
	if (dataOffset < BigInt(INDEX_OFFSET)) return undefined;
	const count = Math.floor((Number(dataOffset) - INDEX_OFFSET) / RECORD_SIZE);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET) + BigInt(indexSize) > source.size) return undefined;

	const entries: FixedEntry[] = [];
	let nextOffset = dataOffset;
	for (let id = 0; id < count; id += 1) {
		const record = await source.readAt(
			BigInt(INDEX_OFFSET + id * RECORD_SIZE),
			RECORD_SIZE,
		);
		const name = decryptName(record);
		if (name === undefined) return undefined;
		const offset = nextOffset;
		// The trailing word chains to the end of this entry.
		nextOffset = BigInt(
			(record.readUInt32LE(0) ^
				record.readUInt32LE(4) ^
				record.readUInt32LE(RECORD_SIZE - 4)) >>>
				0,
		);
		const size = nextOffset - offset;
		if (size < 0n || !checkPlacement(offset, size, source.size))
			return undefined;
		entries.push(
			createFixedEntry({ id, ...normalizeEntryPath(name), offset, size }),
		);
	}
	if (entries.length === 0) return undefined;
	return entries;
}

export const csPackFormat: ArchiveFormat = defineFixedArchive({
	descriptor: csPackDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readCsPackIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const entries = await readCsPackIndex(source);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Cat System CsPack2 layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
});
