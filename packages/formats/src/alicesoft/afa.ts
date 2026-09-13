// Format reference: GARbro "ArcFormats/AliceSoft/ArcAFA.cs", classes `AfaOpener` (both the classic
// and the version three index) and `AfaIndexReader`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { decodeCp932, GarbroError } from "@garbro-mcp/core";
import type {
	ArchiveFormat,
	ByteSource,
	FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateZlibBuffer, MsbBitReader } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("AFAH", "ascii");
const MAGIC = Buffer.from("AlicArch", "ascii");
const INFO = Buffer.from("INFO", "ascii");
const VERSION_OFFSET = 0x10;
const BASE_OFFSET_OFFSET = 0x18;
const INFO_OFFSET = 0x1c;
const PACKED_SIZE_OFFSET = 0x20;
const UNPACKED_SIZE_OFFSET = 0x24;
const COUNT_OFFSET = 0x28;
/** The compressed index follows the fixed header. */
const INDEX_OFFSET = 0x2c;
const HEADER_SIZE = INDEX_OFFSET;
/** Versions below two carry one extra skipped word per record. */
const OLD_VERSION = 2;
/** An `AFF\0` payload holds a keyed prefix in front of the plain body. */
const AFF_HEADER_SIZE = 0x10;
const AFF_MARKER = Buffer.from("AFF\0", "ascii");
const AFF_PREFIX_SIZE = 0x40;
/** `AfaOpener.AffKey`: the key that masks the first bytes of an `AFF` payload. */
const AFF_KEY = Buffer.from([
	0xc8, 0xbb, 0x8f, 0xb7, 0xed, 0x43, 0x99, 0x4a, 0xa2, 0x7e, 0x5b, 0xb0, 0x68,
	0x18, 0xf8, 0x88,
]);

interface AfaEntry {
	path: string;
	rawPath?: string;
	offset: bigint;
	size: bigint;
	affPrefix: number;
}

/**
 * GARbro `AfaOpener.TryOpen`: the version one and two layout, a zlib compressed index of length
 * prefixed names.
 */
async function readAfaV1(source: ByteSource): Promise<AfaEntry[] | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const head = Buffer.from(await source.readAt(0n, HEADER_SIZE));
	if (!head.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (!head.subarray(8, 16).equals(MAGIC)) return readAfaV3(source);
	if (!head.subarray(INFO_OFFSET, INFO_OFFSET + 4).equals(INFO))
		return undefined;
	const version = head.readInt32LE(VERSION_OFFSET);
	const baseOffset = BigInt(head.readUInt32LE(BASE_OFFSET_OFFSET));
	const packedSize = head.readUInt32LE(PACKED_SIZE_OFFSET);
	const unpackedSize = head.readInt32LE(UNPACKED_SIZE_OFFSET);
	const count = head.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	if (
		BigInt(INDEX_OFFSET) + BigInt(packedSize) > source.size ||
		packedSize === 0
	)
		return undefined;
	const packed = Buffer.from(
		await source.readAt(BigInt(INDEX_OFFSET), packedSize),
	);
	let index: Buffer;
	try {
		index = await inflateZlibBuffer(packed);
	} catch {
		return undefined;
	}
	try {
		const entries: AfaEntry[] = [];
		let position = 0;
		for (let i = 0; i < count; i += 1) {
			if (position + 8 > index.length) return undefined;
			const nameLength = index.readInt32LE(position);
			const indexStep = index.readInt32LE(position + 4);
			position += 8;
			if (nameLength <= 0 || nameLength > indexStep) return undefined;
			if (indexStep > unpackedSize) return undefined;
			if (position + indexStep + 8 > index.length) return undefined;
			const name = decodeCp932(index.subarray(position, position + nameLength));
			position += indexStep;
			// Two words are always skipped, and older versions skip a third one.
			position += 8;
			if (version < OLD_VERSION) position += 4;
			if (position + 8 > index.length) return undefined;
			const offset = BigInt(index.readUInt32LE(position)) + baseOffset;
			const size = BigInt(index.readUInt32LE(position + 4));
			position += 8;
			if (!checkPlacement(offset, size, source.size)) return undefined;
			const entry: AfaEntry = {
				...normalizeEntryPath(name),
				offset,
				size,
				affPrefix: 0,
			};
			entry.affPrefix = await affPrefixOf(source, offset, size);
			entries.push(entry);
		}
		return entries;
	} catch {
		return undefined;
	}
}

/** `AfaOpener.OpenEntry`: the `AFF` prefix is unmasked with the repeating key, the rest is plain. */
function decodeAffPrefix(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let index = 0; index < output.length; index += 1)
		output[index] =
			(output[index] ?? 0) ^ (AFF_KEY[index % AFF_KEY.length] ?? 0);
	return output;
}

export const alicesoftAfaDescriptor: FormatDescriptor = {
	id: "alicesoft-afa",
	name: "AliceSoft System 4 resource archive",
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
			source: "ArcFormats/AliceSoft/ArcAFA.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const alicesoftAfaFormat: ArchiveFormat = defineFixedArchive({
	descriptor: alicesoftAfaDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAfa(source)) !== undefined;
	},
	async read(source: ByteSource) {
		const parsed = await readAfa(source);
		if (!parsed)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AliceSoft AFA layout");
		const entries: FixedEntry[] = parsed.map((entry, index) =>
			createFixedEntry({
				id: index,
				path: entry.path,
				...(entry.rawPath !== undefined ? { rawPath: entry.rawPath } : {}),
				offset: entry.offset,
				size: entry.size,
				encrypted: entry.affPrefix > 0,
				...(entry.affPrefix > 0
					? {
							metadata: { affPrefix: entry.affPrefix } as Record<
								string,
								unknown
							>,
						}
					: {}),
			}),
		);
		return { entries, metadata: { entryCount: entries.length } };
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const prefixSize =
			(entry.metadata as { affPrefix?: number } | undefined)?.affPrefix ?? 0;
		const data = Buffer.from(
			await source.readAt(entry.offset, Number(entry.size)),
		);
		if (prefixSize <= 0) return Readable.from([data]);
		// The keyed prefix sits behind a sixteen byte header and is shorter than the payload.
		const start = AFF_HEADER_SIZE;
		const end = start + prefixSize;
		const prefix = decodeAffPrefix(data.subarray(start, end));
		return Readable.from([
			Buffer.concat([data.subarray(0, start), prefix, data.subarray(end)]),
		]);
	},
});
/** The third layout keeps its version word at offset eight. */
const V3_VERSION = 3;
/** The packed index stream starts after the signature, the index size and the version. */
const V3_STREAM_OFFSET = 12;
/** Character codes index the dictionary, so its size stays within a code unit. */
const V3_DICTIONARY_LIMIT = 0x10000;

/**
 * `RandomGenerator` from the reference: a 521 word lagged Fibonacci generator seeded with the size
 * of the dictionary it protects. Every state update is unsigned 32 bit.
 */
class AfaRandom {
	static readonly SIZE = 521;
	readonly #state = new Uint32Array(AfaRandom.SIZE);
	#current = -1;

	constructor(seed: number) {
		let value = 0;
		let state = seed >>> 0;
		for (let i = 0; i < 17; i += 1) {
			for (let j = 0; j < 32; j += 1) {
				state = (Math.imul(1566083941, state) + 1) >>> 0;
				value = ((state & 0x80000000) | (value >>> 1)) >>> 0;
			}
			this.#state[i] = value;
		}
		this.#state[16] =
			((this.#state[15] ?? 0) ^
				((this.#state[0] ?? 0) >>> 9) ^
				((this.#state[16] ?? 0) << 23)) >>>
			0;
		for (let i = 17; i < AfaRandom.SIZE; i += 1) {
			const previous = i - 1;
			const short = i - 16;
			const long = i - 17;
			this.#state[i] =
				((this.#state[previous] ?? 0) ^
					((this.#state[short] ?? 0) >>> 9) ^
					((this.#state[long] ?? 0) << 23)) >>>
				0;
		}
		for (let pass = 0; pass < 4; pass += 1) this.#shuffle();
	}

	getNext(): number {
		this.#current += 1;
		if (this.#current >= AfaRandom.SIZE) {
			this.#shuffle();
			this.#current = 0;
		}
		return this.#state[this.#current] ?? 0;
	}

	#shuffle(): void {
		for (let i = 0; i < 32; i += 4) {
			for (let j = 0; j < 4; j += 1) {
				this.#state[i + j] =
					((this.#state[i + j] ?? 0) ^ (this.#state[i + 489 + j] ?? 0)) >>> 0;
			}
		}
		for (let i = 32; i < AfaRandom.SIZE; i += 3) {
			for (let j = 0; j < 3; j += 1) {
				this.#state[i + j] =
					((this.#state[i + j] ?? 0) ^ (this.#state[i - 32 + j] ?? 0)) >>> 0;
			}
		}
	}
}

/** `AfaIndexReader.ReadInt32`: four bit stream bytes, least significant first. */
function readStreamInt32(bits: MsbBitReader): number | undefined {
	const b0 = bits.tryReadBits(8);
	const b1 = bits.tryReadBits(8);
	const b2 = bits.tryReadBits(8);
	const b3 = bits.tryReadBits(8);
	if (b0 < 0 || b1 < 0 || b2 < 0 || b3 < 0) return undefined;
	return b0 | (b1 << 8) | (b2 << 16) | (b3 << 24) | 0;
}

/**
 * `AfaIndexReader.ReadBytes` and `ReadEncryptedChars`: a size prefix and then, for every element, a
 * generator driven run of unused bits before the data bits.
 */
function readScattered(
	bits: MsbBitReader,
	wide: boolean,
): number[] | undefined {
	const size = readStreamInt32(bits);
	if (size === undefined || size < 0 || size > V3_DICTIONARY_LIMIT)
		return undefined;
	const random = new AfaRandom(size);
	const output: number[] = [];
	for (let index = 0; index < size; index += 1) {
		const count = random.getNext() & 3;
		if (bits.tryReadBits(count + 1) < 0) return undefined;
		random.getNext();
		const low = bits.tryReadBits(8);
		if (low < 0) return undefined;
		if (!wide) {
			output.push(low);
			continue;
		}
		const high = bits.tryReadBits(8);
		if (high < 0) return undefined;
		output.push(low | (high << 8));
	}
	return output;
}

/** `AfaOpener.TryOpen`: the version one and two layout first, then the third one. */
async function readAfa(source: ByteSource): Promise<AfaEntry[] | undefined> {
	return await readAfaV1(source);
}

/** GARbro `AfaOpener.TryOpenV3`: a packed dictionary and a zlib compressed list of names. */
async function readAfaV3(source: ByteSource): Promise<AfaEntry[] | undefined> {
	if (source.size < BigInt(V3_STREAM_OFFSET)) return undefined;
	const head = Buffer.from(await source.readAt(0n, V3_STREAM_OFFSET));
	if (head.readInt32LE(8) !== V3_VERSION) return undefined;
	const indexSize = head.readUInt32LE(4);
	// Entry offsets are relative to the byte just behind the compressed index.
	const dataOffset = BigInt(indexSize) + 8n;
	const streamSize = Number(dataOffset) - V3_STREAM_OFFSET;
	if (streamSize <= 0 || dataOffset > source.size) return undefined;
	const stream = Buffer.from(
		await source.readAt(BigInt(V3_STREAM_OFFSET), streamSize),
	);
	const bits = new MsbBitReader(stream);
	bits.tryReadBits(1);
	const dictionary = readScattered(bits, false);
	if (!dictionary) return undefined;
	const packedSize = readStreamInt32(bits);
	if (packedSize === undefined || packedSize < 0 || packedSize > streamSize)
		return undefined;
	// The unpacked size is read but never used.
	if (readStreamInt32(bits) === undefined) return undefined;
	const packed = Buffer.alloc(packedSize);
	for (let index = 0; index < packedSize; index += 1) {
		const value = bits.tryReadBits(8);
		if (value < 0) return undefined;
		packed[index] = value;
	}
	let index: Buffer;
	try {
		index = await inflateZlibBuffer(packed);
	} catch {
		return undefined;
	}
	const nameBits = new MsbBitReader(index);
	nameBits.tryReadBits(1);
	const count = readStreamInt32(nameBits);
	if (count === undefined || !isSaneCount(count)) return undefined;
	const entries: AfaEntry[] = [];
	for (let i = 0; i < count; i += 1) {
		// A truncated stream ends the listing instead of failing it.
		if (nameBits.tryReadBits(2) < 0) break;
		const chars = readScattered(nameBits, true);
		if (!chars) return undefined;
		const nameBytes = Buffer.alloc(chars.length);
		for (let j = 0; j < chars.length; j += 1) {
			const code = chars[j] ?? 0;
			const mapped = code < dictionary.length ? dictionary[code] : undefined;
			if (mapped === undefined) return undefined;
			nameBytes[j] = mapped ^ 0xa4;
		}
		const name = decodeCp932(nameBytes);
		if (
			readStreamInt32(nameBits) === undefined ||
			readStreamInt32(nameBits) === undefined
		)
			return undefined;
		const storedOffset = readStreamInt32(nameBits);
		const storedSize = readStreamInt32(nameBits);
		if (storedOffset === undefined || storedSize === undefined)
			return undefined;
		const offset = BigInt(storedOffset >>> 0) + dataOffset;
		const size = BigInt(storedSize >>> 0);
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push({
			...normalizeEntryPath(name),
			offset,
			size,
			affPrefix: await affPrefixOf(source, offset, size),
		});
	}
	// The reference declines an archive without a single entry.
	return entries.length > 0 ? entries : undefined;
}

/** GARbro `AfaOpener.OpenEntry`: an `AFF` payload carries a keyed prefix behind a header. */
async function affPrefixOf(
	source: ByteSource,
	offset: bigint,
	size: bigint,
): Promise<number> {
	if (size <= BigInt(AFF_HEADER_SIZE)) return 0;
	const marker = Buffer.from(await source.readAt(offset, AFF_MARKER.length));
	if (!marker.equals(AFF_MARKER)) return 0;
	return Math.min(AFF_PREFIX_SIZE, Number(size) - AFF_HEADER_SIZE);
}
