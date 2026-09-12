// Format reference: GARbro ArcFormats/Nekopack/ArcNEKO2.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	BufferCursor,
	encodeCp932,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import { nekoPackKnownDirectoryNames } from "./v1.js";

const NEKOPACK_SIGNATURE = Buffer.from("NEKOPACK", "ascii");
const HEADER_SIZE = 0x1c;
const MAX_ENTRY_COUNT = 0xfffff;
const UINT64_MASK = 0xffff_ffff_ffff_ffffn;

const shiftMap = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0xc9, 0xca, 0x00, 0xcb, 0xcc, 0xcd, 0xce,
	0xcf, 0xd0, 0xd1, 0x00, 0xd2, 0xd3, 0x27, 0x25, 0xc8, 0x01, 0x02, 0x03, 0x04,
	0x05, 0x06, 0x07, 0x08, 0x09, 0x0a, 0x00, 0xd4, 0x00, 0xd5, 0x00, 0x00, 0xd6,
	0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11, 0x12, 0x13, 0x14, 0x15, 0x16, 0x17,
	0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e, 0x1f, 0x20, 0x21, 0x22, 0x23, 0x24,
	0xd7, 0xc8, 0xd8, 0xd9, 0x26, 0xda, 0x0b, 0x0c, 0x0d, 0x0e, 0x0f, 0x10, 0x11,
	0x12, 0x13, 0x14, 0x15, 0x16, 0x17, 0x18, 0x19, 0x1a, 0x1b, 0x1c, 0x1d, 0x1e,
	0x1f, 0x20, 0x21, 0x22, 0x23, 0x24, 0xdb, 0x00, 0xdc, 0xdd, 0x00, 0x29, 0x2a,
	0x2b, 0x2c, 0x2d, 0x2e, 0x2f, 0x30, 0x31, 0x32, 0x33, 0x34, 0x35, 0x36, 0x37,
	0x38, 0x39, 0x3a, 0x3b, 0x3c, 0x3d, 0x3e, 0x3f, 0x40, 0x41, 0x42, 0x43, 0x44,
	0x45, 0x46, 0x47, 0x48, 0x49, 0x4a, 0x4b, 0x4c, 0x4d, 0x4e, 0x4f, 0x50, 0x51,
	0x52, 0x53, 0x54, 0x55, 0x56, 0x57, 0x58, 0x59, 0x5a, 0x5b, 0x5c, 0x5d, 0x5e,
	0x5f, 0x60, 0x61, 0x62, 0x63, 0x64, 0x65, 0x66, 0x67, 0x68, 0x69, 0x6a, 0x6b,
	0x6c, 0x6d, 0x6e, 0x6f, 0x70, 0x71, 0x72, 0x73, 0x74, 0x75, 0x76, 0x77, 0x78,
	0x79, 0x7a, 0x7b, 0x7c, 0x7d, 0x7e, 0x7f, 0x80, 0x81, 0x82, 0x83, 0x84, 0x85,
	0x86, 0x87, 0x88, 0x89, 0x8a, 0x8b, 0x8c, 0x8d, 0x8e, 0x8f, 0x90, 0x91, 0x92,
	0x93, 0x94, 0x95, 0x96, 0x97, 0x98, 0x99, 0x9a, 0x9b, 0x9c, 0x9d, 0x9e, 0x9f,
	0xa0, 0xa1, 0xa2, 0xa3, 0xa4, 0xa5, 0xa6, 0xa7, 0xa8,
]);

interface NekoPack2Entry extends ArchiveEntry {
	offset: bigint;
	blockKey: number;
	rawSmall: boolean;
}

interface NekoPack2Directory {
	entries: NekoPack2Entry[];
	initialKey: number;
	seed: number;
}

export interface NekoPack2Options {
	readonly knownFileNames?: readonly string[];
}

export const nekoPack2Descriptor: FormatDescriptor = {
	id: "nekopack-2",
	name: "NekoPack version 2 resource archive",
	extensions: ["dat"],
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
			source: "ArcFormats/Nekopack/ArcNEKO2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export function hashNekoPack2Name(seed: number, name: Uint8Array): number {
	let hash = seed >>> 0;
	for (const value of name)
		hash = Math.imul(0x100002a, (shiftMap[value] ?? 0) ^ hash) >>> 0;
	return hash;
}

function byteSwap32(value: number): number {
	return (
		((value >>> 24) |
			((value >>> 8) & 0xff00) |
			((value & 0xff00) << 8) |
			(value << 24)) >>>
		0
	);
}

function nextRandom(value: number, key: number): number {
	const mixed = (key ^ value) >>> 0;
	return (
		((mixed << 4) ^ (mixed >>> 4) ^ (mixed << 3) ^ (mixed >>> 3) ^ mixed) >>> 0
	);
}

function initializeTable(initialKey: number): Uint32Array {
	let key = initialKey >>> 0;
	let a = 0;
	let b = 0;
	do {
		a = (a << 1) >>> 0;
		b ^= 1;
		a = ((((a | b) << (key & 1)) >>> 0) | b) >>> 0;
		key >>>= 1;
	} while ((a & 0x80000000) === 0);
	key = (a << 1) >>> 0;
	a = (key + byteSwap32(key)) >>> 0;
	let count = key & 0xff;
	do {
		a = nextRandom(a, key);
		count = (count - 1) & 0xff;
	} while (count !== 0);
	const table = new Uint32Array(154);
	for (let index = 0; index < table.length; index += 1) {
		a = nextRandom(a, key);
		table[index] = a;
	}
	return table;
}

function laneOperation(
	left: bigint,
	right: bigint,
	bits: number,
	subtract: boolean,
): bigint {
	const width = BigInt(bits);
	const mask = (1n << width) - 1n;
	let result = 0n;
	for (let shift = 0n; shift < 64n; shift += width) {
		const lhs = (left >> shift) & mask;
		const rhs = (right >> shift) & mask;
		const value = subtract ? (lhs - rhs) & mask : (lhs + rhs) & mask;
		result |= value << shift;
	}
	return result & UINT64_MASK;
}

function applyTransform(command: number, left: bigint, right: bigint): bigint {
	if (command === 0 || command === 7) return left ^ right;
	const subtract = command >= 4 && command <= 10;
	const bits =
		command === 1 || command === 4 || command === 8 || command === 11
			? 8
			: command === 2 || command === 5 || command === 9 || command === 12
				? 16
				: 32;
	return laneOperation(left, right, bits, subtract);
}

function createProgram(initialKey: number): {
	transforms: Array<[number, number]>;
	shuffles: number[];
} {
	const t1 = 7 + (initialKey >>> 28);
	const commandBase = initialKey & 0xffff;
	const argumentBase = (initialKey >>> 16) & 0xfff;
	const transforms: Array<[number, number]> = [];
	for (let index = 3; index >= 0; index -= 1) {
		transforms.push([
			((commandBase >>> (4 * index)) + t1) % 14,
			((argumentBase >>> (3 * index)) % 6) + 1,
		]);
	}
	return {
		transforms,
		shuffles: Array.from({ length: 6 }, (_, index) => (index + initialKey) % 6),
	};
}

export function decryptNekoPack2Block(
	initialKey: number,
	blockKey: number,
	data: Buffer,
): void {
	const random = initializeTable(initialKey);
	const program = createProgram(initialKey);
	const mm = Array<bigint>(7).fill(0n);
	let selector = blockKey >>> 0;
	for (let index = 1; index < 7; index += 1) {
		const source = (selector % 0x28) * 2;
		mm[index] =
			BigInt(random[source] ?? 0) | (BigInt(random[source + 1] ?? 0) << 32n);
		selector = Math.floor(selector / 0x28);
	}
	for (let offset = 0; offset + 8 <= data.length; offset += 8) {
		let value = data.readBigUInt64LE(offset);
		for (const [command, argument] of program.transforms)
			value = applyTransform(command, value, mm[argument] ?? 0n);
		data.writeBigUInt64LE(value & UINT64_MASK, offset);
		if (offset + 8 < data.length) {
			for (const shuffle of program.shuffles) {
				const left = shuffle + 1;
				const right = left === 6 ? 1 : left + 1;
				mm[left] = ((mm[left] ?? 0n) + (mm[right] ?? 0n)) & UINT64_MASK;
			}
		}
	}
}

function createNameMap(
	seed: number,
	names: readonly string[],
): ReadonlyMap<number, string> {
	const result = new Map<number, string>();
	for (const name of names) {
		const hash = hashNekoPack2Name(seed, encodeCp932(name));
		if (!result.has(hash)) result.set(hash, name);
	}
	return result;
}

async function readDirectory(
	source: ByteSource,
	knownFileNames: readonly string[],
): Promise<NekoPack2Directory> {
	if (source.size < BigInt(HEADER_SIZE))
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v2 header is truncated");
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 8).equals(NEKOPACK_SIGNATURE))
		throw new GarbroError("INVALID_ARCHIVE", "Invalid NekoPack v2 signature");
	const initialKey = header.readUInt32LE(12);
	const seed = header.readUInt32LE(16);
	const indexInfo = Buffer.from(header.subarray(20, 28));
	decryptNekoPack2Block(initialKey, seed, indexInfo);
	const indexSize = indexInfo.readUInt32LE(0);
	if (indexSize < 20 || indexSize !== indexInfo.readUInt32LE(4))
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"NekoPack v2 index size check failed",
		);
	const alignedIndexSize = (indexSize + 7) & ~7;
	if (BigInt(HEADER_SIZE + indexSize) > source.size)
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v2 index is truncated");
	const index = Buffer.alloc(alignedIndexSize);
	(await source.readAt(BigInt(HEADER_SIZE), indexSize)).copy(index);
	decryptNekoPack2Block(initialKey, seed, index);
	const cursor = new BufferCursor(index.subarray(0, indexSize));
	const directoryNames = createNameMap(initialKey, nekoPackKnownDirectoryNames);
	const fileNames = createNameMap(initialKey, knownFileNames);
	const entries: NekoPack2Entry[] = [];
	let dataOffset = BigInt(HEADER_SIZE + alignedIndexSize);
	while (cursor.remaining > 0) {
		if (cursor.remaining < 12)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"NekoPack v2 directory is truncated",
			);
		const directoryHash = cursor.readU32LE();
		const count = cursor.readI32LE();
		if (
			count !== cursor.readI32LE() ||
			count < 0 ||
			count > MAX_ENTRY_COUNT ||
			cursor.remaining < count * 8
		)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"NekoPack v2 file count is invalid",
			);
		const directory =
			directoryNames.get(directoryHash) ??
			directoryHash.toString(16).padStart(8, "0").toUpperCase();
		for (let item = 0; item < count; item += 1) {
			const nameHash = cursor.readU32LE();
			const storageSize = cursor.readU32LE();
			const name =
				fileNames.get(nameHash) ??
				nameHash.toString(16).padStart(8, "0").toUpperCase();
			if (dataOffset + BigInt(storageSize) > source.size)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`NekoPack v2 entry points outside the archive: ${directory}/${name}`,
				);
			let blockKey = 0;
			let size = storageSize;
			const rawSmall = storageSize <= 12;
			if (!rawSmall) {
				const blockHeader = await source.readAt(dataOffset, 12);
				blockKey = blockHeader.readUInt32LE(0);
				const sizes = Buffer.from(blockHeader.subarray(4));
				decryptNekoPack2Block(initialKey, blockKey, sizes);
				size = sizes.readUInt32LE(0);
				if (size !== sizes.readUInt32LE(4) || size > storageSize - 12)
					throw new GarbroError(
						"INVALID_ARCHIVE",
						`NekoPack v2 entry size check failed: ${directory}/${name}`,
					);
			}
			entries.push({
				id: String(entries.length),
				path: `${directory}/${name}`,
				size: BigInt(size),
				packedSize: BigInt(storageSize),
				compressed: false,
				encrypted: !rawSmall,
				offset: dataOffset,
				blockKey,
				rawSmall,
				metadata: {
					directoryHash: `0x${directoryHash.toString(16).padStart(8, "0")}`,
					nameHash: `0x${nameHash.toString(16).padStart(8, "0")}`,
				},
			});
			dataOffset += BigInt(storageSize);
		}
	}
	if (entries.length === 0)
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v2 archive is empty");
	return { entries, initialKey, seed };
}

class NekoPack2ArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = nekoPack2Descriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly NekoPack2Entry[];
	readonly #source: ByteSource;
	readonly #initialKey: number;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: NekoPack2Directory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.#initialKey = directory.initialKey;
		this.metadata = {
			version: 2,
			initialKey: `0x${directory.initialKey.toString(16).padStart(8, "0")}`,
			seed: `0x${directory.seed.toString(16).padStart(8, "0")}`,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		if (entry.rawSmall)
			return this.#source.createReadStream(entry.offset, entry.size);
		const size = bigintToBufferLength(entry.size, "NekoPack v2 entry");
		const alignedSize = (size + 7) & ~7;
		const data = Buffer.alloc(alignedSize);
		(await this.#source.readAt(entry.offset + 12n, size)).copy(data);
		decryptNekoPack2Block(this.#initialKey, entry.blockKey, data);
		return Readable.from([data.subarray(0, size)]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class NekoPack2Format implements ArchiveFormat {
	readonly descriptor = nekoPack2Descriptor;
	readonly detection = {
		signatures: [{ bytes: NEKOPACK_SIGNATURE }],
		priority: 1,
	};
	readonly #knownFileNames: readonly string[];
	constructor(options: NekoPack2Options = {}) {
		this.#knownFileNames = options.knownFileNames ?? [];
	}

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		try {
			const header = await source.readAt(0n, HEADER_SIZE);
			if (!header.subarray(0, 8).equals(NEKOPACK_SIGNATURE)) return false;
			const info = Buffer.from(header.subarray(20));
			decryptNekoPack2Block(
				header.readUInt32LE(12),
				header.readUInt32LE(16),
				info,
			);
			const size = info.readUInt32LE(0);
			return (
				size >= 20 &&
				size === info.readUInt32LE(4) &&
				BigInt(HEADER_SIZE + size) < source.size
			);
		} catch {
			return false;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new NekoPack2ArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source, this.#knownFileNames),
		);
	}
}
