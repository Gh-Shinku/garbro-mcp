// Format reference: GARbro ArcFormats/CsWare/ArcPCS.cs, classes `PcsOpener` and `PcsArchive`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { MersenneTwister } from "@garbro-mcp/codecs";
import { createHash } from "node:crypto";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PCCS", "latin1");
const VERSION_FIELD = 4;
const SHUFFLE_KEY_FIELD = 6;
const COUNT_FIELD = 8;
const DATA_OFFSET_FIELD = 0xc;
const INDEX_OFFSET = 0x10;
const MIN_VERSION = 1;
const MAX_VERSION = 6;
/** Every name field is a 32 bit length, one byte and the name itself. */
const LENGTH_SIZE = 4;
const NAME_PREFIX_SIZE = 5;
/** From version 4 on a record ends with eight scrambled bytes and sixteen in total. */
const SCRAMBLED_SIZE = 8;
const ENTRY_FOOTER_SIZE = 0x10;
/** Payloads are scrambled over their first 512 bytes only. */
const DECRYPT_SIZE = 512;
/** The scramble rotates names and their payload header by four bits. */
const ROTATE_BITS = 4;
const KEY_STRIDE = 17;
const KEY_MASK = 0x33;
/** The version 6 shuffle cuts the buffer into 32 blocks. */
const SHUFFLE_BLOCKS = 0x20;
const SHUFFLE_SHIFT = 5;

interface PcsEntry {
	name: string;
	offset: bigint;
	size: bigint;
	key: number;
	nameHash?: number;
}

interface PcsIndex {
	version: number;
	entries: PcsEntry[];
}

async function readRange(
	source: ByteSource,
	offset: number,
	length: number,
): Promise<Buffer | undefined> {
	if (offset < 0 || length < 0) return undefined;
	if (BigInt(offset) + BigInt(length) > source.size) return undefined;
	return Buffer.from(await source.readAt(BigInt(offset), length));
}

/** `Binary.RotByteL` with a count of four, which swaps the two nibbles of a byte. */
export function rotateByteNibbles(value: number, bits: number): number {
	const shift = bits & 7;
	return ((value << shift) | (value >> (8 - shift))) & 0xff;
}

/** `PcsOpener.DecryptName`: nibble swap every byte up to the first NUL and sum them. */
function decryptName(
	index: Buffer,
	offset: number,
	length: number,
): { name: string; checksum: number } | undefined {
	if (offset < 0 || length < 0 || offset + length > index.length)
		return undefined;
	let checksum = 0;
	let count = 0;
	for (; count < length; count += 1) {
		const raw = index[offset + count];
		if (raw === undefined) return undefined;
		if (raw === 0) break;
		const rotated = rotateByteNibbles(raw, ROTATE_BITS);
		index[offset + count] = rotated;
		checksum = (checksum + rotated) & 0xff;
	}
	return {
		name: decodeCp932(index.subarray(offset, offset + count)),
		checksum,
	};
}

/** `PcsOpener.ShuffleBlocks`: a mersenne twister picks the order of the 32 blocks. */
export function shuffleBlocks(input: Buffer, key: number): Buffer {
	const blockSize = input.length >>> SHUFFLE_SHIFT;
	const output = Buffer.alloc(input.length);
	const twister = new MersenneTwister(key >>> 0);
	let copied = 0;
	for (let block = 0; block < SHUFFLE_BLOCKS; block += 1) {
		let source = twister.rand() & (SHUFFLE_BLOCKS - 1);
		while ((copied & (1 << source)) !== 0)
			source = (source + 1) & (SHUFFLE_BLOCKS - 1);
		copied |= 1 << source;
		input.copy(
			output,
			block * blockSize,
			source * blockSize,
			source * blockSize + blockSize,
		);
	}
	const shuffled = blockSize << SHUFFLE_SHIFT;
	if (shuffled !== input.length)
		input.copy(output, shuffled, shuffled, input.length);
	return output;
}

/** `PcsOpener.ComputeHash`: the first four bytes of the SHA-1 of the name, read big endian. */
function computeNameHash(
	index: Buffer,
	offset: number,
	length: number,
): number | undefined {
	if (offset < 0 || length < 0 || offset + length > index.length)
		return undefined;
	const digest = createHash("sha1")
		.update(index.subarray(offset, offset + length))
		.digest();
	return digest.readUInt32BE(0);
}

/**
 * GARbro `PcsOpener.TryOpen`. The index sits between the header and the payload area, and from version 6 on it
 * is shuffled in blocks. Every record may carry a second, skipped name field, and from version 4 on its
 * footer holds the scrambled payload offset and size with a key derived from the name checksum.
 */
async function readPcsIndex(source: ByteSource): Promise<PcsIndex | undefined> {
	const header = await readRange(source, 0, INDEX_OFFSET);
	if (!header?.subarray(0, SIGNATURE.length).equals(SIGNATURE))
		return undefined;
	const version = header.readUInt16LE(VERSION_FIELD);
	if (version < MIN_VERSION || version > MAX_VERSION) return undefined;
	const count = header.readInt32LE(COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_FIELD));
	const indexSize = Number(dataOffset) - INDEX_OFFSET;
	if (indexSize < 0) return undefined;
	let index = await readRange(source, INDEX_OFFSET, indexSize);
	if (!index) return undefined;
	if (version === MAX_VERSION)
		index = shuffleBlocks(index, header.readUInt16LE(SHUFFLE_KEY_FIELD));
	const entries: PcsEntry[] = [];
	let position = 0;
	for (let id = 0; id < count; id += 1) {
		if (version > MIN_VERSION) {
			// The first field repeats the name and is only walked over.
			if (position + LENGTH_SIZE > index.length) return undefined;
			const skipped = index.readInt32LE(position);
			if (skipped === 0) break;
			if (skipped > indexSize) return undefined;
			position += NAME_PREFIX_SIZE + skipped;
		}
		if (position + NAME_PREFIX_SIZE > index.length) return undefined;
		const declared = index.readInt32LE(position);
		if (declared === 0) break;
		if (declared > indexSize) return undefined;
		position += NAME_PREFIX_SIZE;
		const decrypted = decryptName(index, position, declared);
		if (!decrypted) return undefined;
		const { name, checksum } = decrypted;
		let key = 0;
		let nameHash: number | undefined;
		if (version >= 4) {
			key = checksum;
			if (version === MAX_VERSION) {
				nameHash = computeNameHash(index, position, declared - 1);
				if (nameHash === undefined) return undefined;
			}
			position += declared;
			if (position + SCRAMBLED_SIZE > index.length) return undefined;
			const base = (-1 - checksum) & 0xff;
			for (let step = 0; step < 4; step += 1) {
				const mask = (checksum + (KEY_STRIDE << step)) & KEY_MASK;
				for (const extra of [0, 4]) {
					const at = position + step + extra;
					const value = index[at] ?? 0;
					index[at] = (base + mask - value) & 0xff;
				}
			}
		} else {
			position += declared;
		}
		if (BigInt(position) > dataOffset) return undefined;
		if (position + SCRAMBLED_SIZE > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(position)) + dataOffset;
		const size = BigInt(index.readUInt32LE(position + 4));
		if (offset + size > source.size) return undefined;
		entries.push({
			name,
			offset,
			size,
			key,
			...(nameHash === undefined ? {} : { nameHash }),
		});
		position += ENTRY_FOOTER_SIZE;
	}
	if (entries.length === 0) return undefined;
	return { version, entries };
}

function toFixedEntries(index: PcsIndex): FixedEntry[] {
	return index.entries.map((entry, id) =>
		createFixedEntry({
			id,
			...normalizeEntryPath(entry.name),
			offset: entry.offset,
			size: entry.size,
			encrypted: index.version >= 4,
			metadata: {
				type: "data",
				key: entry.key,
				...(entry.nameHash === undefined ? {} : { nameHash: entry.nameHash }),
			},
		}),
	);
}

export const pcsDescriptor: FormatDescriptor = {
	id: "csware-pcs",
	name: "C's ware resource archive",
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
			source: "ArcFormats/CsWare/ArcPCS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const pcsFormat = defineFixedArchive({
	descriptor: pcsDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPcsIndex(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const index = await readPcsIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid C's ware PCS layout");
		return {
			entries: toFixedEntries(index),
			metadata: { entryCount: index.entries.length, version: index.version },
		};
	},
	/**
	 * `PcsOpener.OpenEntry` unscrambles the first 512 bytes of a payload, shuffling them in version 6 first,
	 * and leaves the rest of the payload as it is stored.
	 */
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const stored = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		// Below version 4 the reference hands payloads back as they are stored.
		if (!entry.encrypted) return Readable.from([stored]);
		const key = Number(entry.metadata?.key ?? 0);
		const nameHash = Number(entry.metadata?.nameHash ?? 0);
		const headerSize = Number(
			entry.size < BigInt(DECRYPT_SIZE) ? entry.size : BigInt(DECRYPT_SIZE),
		);
		let header: Buffer = stored.subarray(0, headerSize);
		if (entry.metadata?.nameHash !== undefined)
			header = shuffleBlocks(header, nameHash);
		for (let position = 0; position < header.length; position += 1)
			header[position] = (key - (header[position] ?? 0) - 1) & 0xff;
		if (headerSize === Number(entry.size)) return Readable.from([header]);
		const rest = stored.subarray(DECRYPT_SIZE);
		return Readable.from([Buffer.concat([header, rest])]);
	},
});
