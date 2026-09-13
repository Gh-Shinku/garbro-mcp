// Format reference: GARbro "ArcFormats/LiveMaker/ArcVF.cs", classes `VffOpener`, `VfEntry`,
// `TpRandom` and `TpScramble`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createZlibInflateStream } from "@garbro-mcp/codecs";
import {
	FileByteSource,
	GarbroError,
	decodeCp932,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { existsSync } from "node:fs";
import { basename } from "node:path";
import { Readable } from "node:stream";
import { changeExtension, readCompanionFile } from "../shared/companion.js";
import { findExecutableOverlay } from "../shared/exe.js";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = 0x00666676; // 'vff\0'
const INDEX_BASE = 0xa;
const NAME_LIMIT = 0x100;
const NAME_SEED = 0x75d6ee39;
const SCRAMBLE_MASK = 0xf8ea;
const FLAG_PACKED = 0;
const FLAG_SCRAMBLED = 2;
const FLAG_BOTH = 3;
const PART_LIMIT = 100;
const HEADER_SIZE = 8;
/** An entry needs four bytes for the name length, the name, two offsets and a flag byte. */
const ENTRY_OVERHEAD = 4 + NAME_LIMIT + 8 + 1;
/** The index grows with the entry count, so the read is bounded by the header and the file size. */
function indexReadSize(count: number, available: bigint): number {
	const wanted = BigInt(INDEX_BASE + ENTRY_OVERHEAD * count + 8);
	return Number(available < wanted ? available : wanted);
}

/**
 * GARbro `TpRandom`: a small linear congruential generator used to scramble the index. Only the low
 * byte is used, but the full value is returned.
 */
class TpRandom {
	readonly #seed: number;
	#current = 0;

	constructor(seed: number) {
		this.#seed = seed >>> 0;
	}

	getRand32(): number {
		this.#current = (this.#current + (this.#current << 2) + this.#seed) >>> 0;
		return this.#current;
	}

	reset(): void {
		this.#current = 0;
	}
}

const FACTOR_A = 2111111111n;
const FACTOR_B = 1492n;
const FACTOR_C = 1776n;
const FACTOR_D = 5115n;
const UINT32 = 0xffffffffn;

/**
 * GARbro `TpScramble`: a five word multiply with carry generator used to shuffle entry chunks. The
 * products exceed the double precision range, so the accumulator is kept in a big integer.
 */
class TpScramble {
	readonly #state = [0, 0, 0, 0, 0];

	constructor(seed: number) {
		let hash = (seed !== 0 ? seed : 0xffffffff) >>> 0;
		for (let index = 0; index < 5; index += 1) {
			hash = (hash ^ (hash << 13)) >>> 0;
			hash = (hash ^ (hash >>> 17)) >>> 0;
			hash = (hash ^ (hash << 5)) >>> 0;
			this.#state[index] = hash;
		}
		for (let index = 0; index < 19; index += 1) this.getUInt32();
	}

	getUInt32(): number {
		const state = this.#state;
		const value =
			FACTOR_A * BigInt(state[3] ?? 0) +
			FACTOR_B * BigInt(state[2] ?? 0) +
			FACTOR_C * BigInt(state[1] ?? 0) +
			FACTOR_D * BigInt(state[0] ?? 0) +
			BigInt(state[4] ?? 0);
		state[3] = state[2] ?? 0;
		state[2] = state[1] ?? 0;
		state[1] = state[0] ?? 0;
		state[4] = Number((value >> 32n) & UINT32);
		const low = Number(value & UINT32);
		state[0] = low;
		return low;
	}

	/** GARbro `TpScramble.GetInt32`: the range is inclusive on both ends. */
	getInt32(first: number, last: number): number {
		const value = this.getUInt32() / 0x100000000;
		return Math.trunc(first + value * (last - first + 1));
	}
}

/**
 * GARbro `VffOpener.RandomSequence`: draws positions from a shrinking list and records the order in
 * which they were drawn. The remaining position is filled in after the loop.
 */
function randomSequence(count: number, seed: number): number[] {
	const scramble = new TpScramble(seed);
	const order: number[] = [];
	for (let index = 0; index < count; index += 1) order.push(index);
	const sequence = new Array<number>(count).fill(0);
	let step = 0;
	while (order.length > 1) {
		const pick = scramble.getInt32(0, order.length - 2);
		const chosen = order[pick] ?? 0;
		sequence[chosen] = step;
		order.splice(pick, 1);
		step += 1;
	}
	sequence[order[0] ?? 0] = count - 1;
	return sequence;
}

/**
 * GARbro `VffOpener.ReshuffleStream`: an eight byte header names the chunk size and the shuffle seed,
 * and the chunks that follow are written back in draw order.
 */
function reshuffleStream(data: Buffer): Buffer {
	if (data.length < HEADER_SIZE) return Buffer.alloc(0);
	const chunkSize = data.readInt32LE(0);
	const seed = (data.readUInt32LE(4) ^ SCRAMBLE_MASK) >>> 0;
	const inputLength = data.length - HEADER_SIZE;
	if (chunkSize <= 0) return Buffer.alloc(0);
	const count = Math.trunc((inputLength - 1) / chunkSize) + 1;
	const output = Buffer.alloc(inputLength);
	let destination = 0;
	for (const position of randomSequence(count, seed)) {
		const start = position * chunkSize;
		const length = Math.min(chunkSize, inputLength - start);
		if (length <= 0) continue;
		data.copy(
			output,
			destination,
			HEADER_SIZE + start,
			HEADER_SIZE + start + length,
		);
		destination += length;
	}
	return output;
}

interface VfEntryInfo {
	path: string;
	rawPath?: string;
	offset: bigint;
	size: number;
	packed: boolean;
	scrambled: boolean;
}

/** GARbro `VffOpener.DecryptName`: every name byte is XORed with the low byte of the next draw. */
function decryptName(
	nameBuffer: Buffer,
	nameLength: number,
	random: TpRandom,
): string {
	const output = Buffer.from(nameBuffer.subarray(0, nameLength));
	for (let index = 0; index < nameLength; index += 1)
		output[index] = (output[index] ?? 0) ^ (random.getRand32() & 0xff);
	return decodeCp932(output);
}

/** GARbro reads a signed 64-bit offset and XORs it with the sign extended 32-bit draw. */
function readScrambledOffset(
	index: Buffer,
	position: number,
	draw: number,
): bigint {
	return index.readBigInt64LE(position) ^ BigInt.asIntN(64, BigInt(draw | 0));
}

/**
 * GARbro `VffOpener.ReadIndex`: a run of XOR scrambled names, a chain of XOR scrambled signed offsets,
 * and one flag byte per entry.
 */
function readIndex(
	index: Buffer,
	baseOffset: bigint,
	count: number,
): VfEntryInfo[] | undefined {
	// The buffer starts at the base offset, so the offsets are relative to it in the file.
	const start = INDEX_BASE;
	if (start > index.length) return undefined;
	let position = start;
	const random = new TpRandom(NAME_SEED);
	const names: { path: string; rawPath?: string }[] = [];
	for (let i = 0; i < count; i += 1) {
		if (position + 4 > index.length) return undefined;
		const nameLength = index.readUInt32LE(position);
		position += 4;
		if (nameLength === 0 || nameLength > NAME_LIMIT) return undefined;
		if (position + nameLength > index.length) return undefined;
		const name = decryptName(
			index.subarray(position, position + nameLength),
			nameLength,
			random,
		);
		position += nameLength;
		names.push(normalizeEntryPath(name));
	}
	random.reset();
	if (position + 8 > index.length) return undefined;
	let offset =
		baseOffset + readScrambledOffset(index, position, random.getRand32());
	const entries: VfEntryInfo[] = [];
	for (const name of names) {
		position += 8;
		if (position + 8 > index.length) return undefined;
		const next =
			baseOffset + readScrambledOffset(index, position, random.getRand32());
		const size = next - offset;
		if (size < 0n) return undefined;
		entries.push({
			...name,
			offset,
			size: Number(size),
			packed: false,
			scrambled: false,
		});
		offset = next;
	}
	position += 8;
	for (const entry of entries) {
		if (position >= index.length) return undefined;
		const flags = index[position] ?? 0;
		position += 1;
		entry.packed = flags === FLAG_PACKED || flags === FLAG_BOTH;
		entry.scrambled = flags === FLAG_SCRAMBLED || flags === FLAG_BOTH;
	}
	return entries;
}

/** GARbro `VffOpener.TryOpen` collects numbered parts that continue the address space. */
function partNames(sourcePath: string): string[] {
	const names: string[] = [];
	for (let part = 1; part < PART_LIMIT; part += 1) {
		const name = changeExtension(sourcePath, String(part).padStart(3, "0"));
		if (!existsSync(name)) break;
		names.push(name);
	}
	return names;
}

interface VfContext {
	baseOffset: bigint;
	entries: VfEntryInfo[];
	parts: string[];
	totalSize: bigint;
}

/**
 * Reads the header, then the index from the main file or from the sibling `.ext` file, and collects the
 * numbered parts that continue the archive.
 */
async function readVfContext(
	source: ByteSource,
	sourcePath: string,
): Promise<VfContext | undefined> {
	const lower = sourcePath.toLowerCase();
	if (source.size < HEADER_SIZE) return undefined;
	let baseOffset = 0n;
	let signature = Buffer.from(await source.readAt(0n, 4)).readUInt32LE(0);
	let indexBytes: Buffer | undefined;
	if (lower.endsWith(".exe") && (signature & 0xffff) === 0x5a4d) {
		const overlay = await findExecutableOverlay(source);
		if (!overlay || overlay.offset >= source.size) return undefined;
		baseOffset = overlay.offset;
		signature = Buffer.from(await source.readAt(baseOffset, 4)).readUInt32LE(0);
		if (signature !== SIGNATURE) return undefined;
		indexBytes = await readIndexBytes(source, baseOffset, source.size);
	} else if (!lower.endsWith(".dat")) {
		return undefined;
	} else if (signature !== SIGNATURE) {
		// The index may live in a sibling file with the extension replaced by `.ext`.
		const extName = changeExtension(sourcePath, "ext");
		if (!existsSync(extName)) return undefined;
		indexBytes = await readCompanionFile(sourcePath, basename(extName));
		baseOffset = 0n;
		if (!indexBytes || indexBytes.length < INDEX_BASE) return undefined;
		if (indexBytes.readUInt32LE(0) !== SIGNATURE) return undefined;
	}
	if (!indexBytes)
		indexBytes = await readIndexBytes(source, baseOffset, source.size);
	// The index buffer starts at the base offset, so its fields are relative to it.
	if (indexBytes.length < INDEX_BASE) return undefined;
	const count = indexBytes.readInt32LE(6);
	if (!isSaneCount(count)) return undefined;
	const entries = readIndex(indexBytes, baseOffset, count);
	if (!entries) return undefined;
	const parts = sourcePath ? partNames(sourcePath) : [];
	let totalSize = source.size;
	for (const part of parts) {
		try {
			const opened = await FileByteSource.open(part);
			try {
				totalSize += opened.size;
			} finally {
				await opened.close();
			}
		} catch {
			break;
		}
	}
	for (const entry of entries)
		if (!checkPlacement(entry.offset, BigInt(entry.size), totalSize))
			return undefined;
	return { baseOffset, entries, parts, totalSize };
}

/**
 * Reads an eight byte header at `baseOffset` so the entry count is known before the whole index is
 * read into memory.
 */
async function readIndexBytes(
	source: ByteSource,
	baseOffset: bigint,
	totalSize: bigint,
): Promise<Buffer> {
	const available = totalSize - baseOffset;
	if (available < BigInt(INDEX_BASE)) return Buffer.alloc(0);
	const header = Buffer.from(await source.readAt(baseOffset, INDEX_BASE));
	const count = header.readInt32LE(6);
	if (!isSaneCount(count)) return header;
	const size = indexReadSize(count, available);
	if (size <= INDEX_BASE) return header;
	return Buffer.from(await source.readAt(baseOffset, size));
}

export const livemakerVfDescriptor: FormatDescriptor = {
	id: "livemaker-dat-vf",
	name: "LiveMaker resource archive",
	extensions: ["dat", "exe"],
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
			source: "ArcFormats/LiveMaker/ArcVF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const livemakerVfFormat: ArchiveFormat = defineFixedArchive({
	descriptor: livemakerVfDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readVfContext(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const context = await readVfContext(source, sourcePath);
		if (!context)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid LiveMaker archive");
		const fixed: FixedEntry[] = context.entries.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.rawPath ?? entry.path),
				offset: entry.offset,
				size: BigInt(entry.size),
				packedSize: BigInt(entry.size),
				compressed: entry.packed,
				encrypted: entry.scrambled,
				metadata: {
					packed: entry.packed,
					scrambled: entry.scrambled,
				} as Record<string, unknown>,
			});
			// A scrambled entry loses its eight byte header, and a packed entry grows back to its
			// unpacked size, which is not known before decompression.
			const size =
				BigInt(entry.size) - (entry.scrambled ? BigInt(HEADER_SIZE) : 0n);
			const adjusted =
				size > 0n ? { ...created, size } : { ...created, size: 0n };
			return entry.packed ? { ...adjusted, sizeKnown: false } : adjusted;
		});
		return {
			entries: fixed,
			metadata: {
				entryCount: fixed.length,
				baseOffset: context.baseOffset.toString(),
				parts: context.parts.length,
				encrypted: true,
			},
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = (entry.metadata ?? {}) as {
			packed?: boolean;
			scrambled?: boolean;
		};
		const offset = entry.offset ?? 0n;
		const storedSize = BigInt(entry.packedSize ?? entry.size);
		const raw = await readRange(source, offset, storedSize);
		const data = metadata.scrambled ? reshuffleStream(raw) : raw;
		if (!metadata.packed) return Readable.from([data]);
		return createZlibInflateStream(Readable.from([data]));
	},
});

/**
 * Reads a range from the main file, or from the numbered parts that follow it. The parts continue the
 * address space, so a range can straddle the end of the main file.
 */
async function readRange(
	source: ByteSource,
	offset: bigint,
	length: bigint,
): Promise<Buffer> {
	if (length <= 0n) return Buffer.alloc(0);
	const path = source.path;
	if (!path && offset + length > source.size)
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Entry spans missing archive parts",
		);
	if (path && offset + length <= source.size)
		return Buffer.from(await source.readAt(offset, Number(length)));
	const chunks: Buffer[] = [];
	let position = offset;
	let remaining = length;
	const consume = async (
		part: ByteSource,
		partStart: bigint,
	): Promise<void> => {
		const start = position > partStart ? position - partStart : 0n;
		const available = part.size - start;
		if (available <= 0n) return;
		const take = available < remaining ? available : remaining;
		chunks.push(Buffer.from(await part.readAt(start, Number(take))));
		position = partStart + start + take;
		remaining -= take;
	};
	await consume(source, 0n);
	if (remaining > 0n && path) {
		let partStart = source.size;
		for (const name of partNames(path)) {
			if (remaining <= 0n) break;
			const opened = await FileByteSource.open(name);
			try {
				await consume(opened, partStart);
				partStart += opened.size;
			} finally {
				await opened.close();
			}
		}
	}
	return Buffer.concat(chunks);
}
