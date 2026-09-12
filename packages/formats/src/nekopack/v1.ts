// Format reference: GARbro ArcFormats/Nekopack/ArcNEKO.cs
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

const NEKOPACK_SIGNATURE = Buffer.from("NEKOPACK", "ascii");
const HEADER_SIZE = 0x18;
const MAX_ENTRY_COUNT = 0xfffff;

export const nekoPackKnownDirectoryNames = [
	"image/actor",
	"image/back",
	"image/mask",
	"image/visual",
	"image/actor/big",
	"image/face",
	"image/actor/b",
	"image/actor/bb",
	"image/actor/s",
	"image/actor/ss",
	"sound/bgm",
	"sound/env",
	"sound/se",
	"sound/bgv",
	"voice",
	"script",
	"system",
	"count",
] as const;

const shiftMap = Buffer.from([
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
	0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x38, 0x2f, 0x33, 0x3c, 0x40, 0x3b, 0x2a,
	0x2e, 0x31, 0x30, 0x26, 0x44, 0x35, 0x28, 0x3e, 0x12, 0x02, 0x22, 0x06, 0x20,
	0x1a, 0x1c, 0x0f, 0x11, 0x18, 0x17, 0x42, 0x2b, 0x3a, 0x37, 0x34, 0x0c, 0x41,
	0x08, 0x1d, 0x07, 0x15, 0x21, 0x05, 0x1e, 0x0a, 0x14, 0x0e, 0x10, 0x09, 0x27,
	0x1f, 0x0b, 0x23, 0x16, 0x0d, 0x01, 0x25, 0x04, 0x1b, 0x03, 0x13, 0x24, 0x19,
	0x2d, 0x12, 0x29, 0x32, 0x3f, 0x3d, 0x08, 0x1d, 0x07, 0x15, 0x21, 0x05, 0x1e,
	0x0a, 0x14, 0x0e, 0x10, 0x09, 0x27, 0x1f, 0x0b, 0x23, 0x16, 0x0d, 0x01, 0x25,
	0x04, 0x1b, 0x03, 0x13, 0x24, 0x19, 0x2c, 0x39, 0x43, 0x36, 0x00, 0x4b, 0xa9,
	0xa7, 0xaf, 0x50, 0x52, 0x91, 0x9f, 0x47, 0x6b, 0x96, 0xab, 0x87, 0xb5, 0x9b,
	0xbb, 0x99, 0xa4, 0xbf, 0x5c, 0xc6, 0x9c, 0xc2, 0xc4, 0xb6, 0x4f, 0xb8, 0xc1,
	0x85, 0xa8, 0x51, 0x7e, 0x5f, 0x82, 0x73, 0xc7, 0x90, 0x4e, 0x45, 0xa5, 0x7a,
	0x63, 0x70, 0xb3, 0x79, 0x83, 0x60, 0x55, 0x5b, 0x5e, 0x68, 0xba, 0x53, 0xa1,
	0x67, 0x97, 0xac, 0x71, 0x81, 0x59, 0x64, 0x7c, 0x9d, 0xbd, 0x9d, 0xbd, 0x95,
	0xa0, 0xb2, 0xc0, 0x6f, 0x6a, 0x54, 0xb9, 0x6d, 0x88, 0x77, 0x48, 0x5d, 0x72,
	0x49, 0x93, 0x57, 0x65, 0xbe, 0x4a, 0x80, 0xa2, 0x5a, 0x98, 0xa6, 0x62, 0x7f,
	0x84, 0x75, 0xbc, 0xad, 0xb1, 0x6e, 0x76, 0x8b, 0x9e, 0x8c, 0x61, 0x69, 0x8d,
	0xb4, 0x78, 0xaa, 0xae, 0x8f, 0xc3, 0x58, 0xc5, 0x74, 0xb7, 0x8e, 0x7d, 0x89,
	0x8a, 0x56, 0x4d, 0x86, 0x94, 0x9a, 0x4c, 0x92, 0xb0,
]);

interface NekoPack1Entry extends ArchiveEntry {
	offset: bigint;
	blockKey: number;
}

interface NekoPack1Directory {
	entries: NekoPack1Entry[];
	seed: number;
}

export interface NekoPack1Options {
	readonly knownFileNames?: readonly string[];
}

export const nekoPack1Descriptor: FormatDescriptor = {
	id: "nekopack-1",
	name: "NekoPack version 1 resource archive",
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
			source: "ArcFormats/Nekopack/ArcNEKO.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export function hashNekoPack1Name(seed: number, name: Uint8Array): number {
	let hash = seed >>> 0;
	for (const value of name) {
		hash = Math.imul(81, (shiftMap[value] ?? 0) ^ hash) >>> 0;
	}
	return hash;
}

function keyFromHash(hash: number): bigint {
	const v2 = (hash ^ ((hash + 1_566_083_941) >>> 0)) >>> 0;
	const v3 = (v2 ^ ((hash - 899_497_514) >>> 0)) >>> 0;
	const low = (v3 ^ ((v2 - 1_894_007_588) >>> 0)) >>> 0;
	const high = (low ^ ((v3 + 1_812_433_253) >>> 0)) >>> 0;
	return BigInt(low) | (BigInt(high) << 32n);
}

function packedAddWords(left: bigint, right: bigint): bigint {
	let result = 0n;
	for (let shift = 0n; shift < 64n; shift += 16n) {
		const word = ((left >> shift) + (right >> shift)) & 0xffffn;
		result |= word << shift;
	}
	return result;
}

export function decryptNekoPack1Block(keyHash: number, data: Buffer): void {
	let key = keyFromHash(keyHash);
	for (let offset = 0; offset + 8 <= data.length; offset += 8) {
		const value = data.readBigUInt64LE(offset) ^ key;
		data.writeBigUInt64LE(value, offset);
		key = packedAddWords(key, value);
	}
}

function createNameMap(
	seed: number,
	names: readonly string[],
): ReadonlyMap<number, string> {
	const result = new Map<number, string>();
	for (const name of names) {
		const hash = hashNekoPack1Name(seed, encodeCp932(name));
		if (!result.has(hash)) result.set(hash, name);
	}
	return result;
}

async function readEncryptedBlock(
	source: ByteSource,
	offset: bigint,
): Promise<{ key: number; data: Buffer; size: number }> {
	if (offset < 0n || offset + 8n > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"NekoPack block header is truncated",
		);
	}
	const header = await source.readAt(offset, 8);
	const key = header.readUInt32LE(0);
	const size = header.readInt32LE(4);
	if (size < 0 || BigInt(size) > source.size - offset - 8n) {
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack block size is invalid");
	}
	const alignedSize = (size + 7) & ~7;
	const data = Buffer.alloc(alignedSize);
	(await source.readAt(offset + 8n, size)).copy(data);
	if (key !== 0) decryptNekoPack1Block(key, data);
	return { key, data, size };
}

async function readDirectory(
	source: ByteSource,
	knownFileNames: readonly string[],
): Promise<NekoPack1Directory> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v1 header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 8).equals(NEKOPACK_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid NekoPack v1 signature");
	}
	const seed = header.readUInt32LE(8);
	const index = await readEncryptedBlock(source, 0x10n);
	if (index.size < 16) {
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v1 index is too small");
	}
	const directoryNames = createNameMap(seed, nekoPackKnownDirectoryNames);
	const fileNames = createNameMap(seed, knownFileNames);
	const cursor = new BufferCursor(index.data.subarray(0, index.size));
	const entries: NekoPack1Entry[] = [];
	let dataOffset = BigInt(HEADER_SIZE + index.size);
	while (cursor.remaining > 0) {
		if (cursor.remaining < 8) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"NekoPack v1 directory is truncated",
			);
		}
		const directoryHash = cursor.readU32LE();
		const count = cursor.readI32LE();
		if (count < 0 || count > MAX_ENTRY_COUNT || cursor.remaining < count * 8) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"NekoPack v1 file count is invalid",
			);
		}
		const directory =
			directoryNames.get(directoryHash) ??
			directoryHash.toString(16).padStart(8, "0").toUpperCase();
		for (let item = 0; item < count; item += 1) {
			const nameHash = cursor.readU32LE();
			const size = cursor.readU32LE();
			const name =
				fileNames.get(nameHash) ??
				nameHash.toString(16).padStart(8, "0").toUpperCase();
			if (
				dataOffset + 8n > source.size ||
				BigInt(size) > source.size - dataOffset - 8n
			) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`NekoPack v1 entry points outside the archive: ${directory}/${name}`,
				);
			}
			const blockHeader = await source.readAt(dataOffset, 8);
			const blockKey = blockHeader.readUInt32LE(0);
			const storedSize = blockHeader.readUInt32LE(4);
			if (storedSize !== size) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`NekoPack v1 entry size mismatch: ${directory}/${name}`,
				);
			}
			entries.push({
				id: String(entries.length),
				path: `${directory}/${name}`,
				size: BigInt(size),
				packedSize: BigInt(size),
				compressed: false,
				encrypted: blockKey !== 0,
				offset: dataOffset,
				blockKey,
				metadata: {
					directoryHash: `0x${directoryHash.toString(16).padStart(8, "0")}`,
					nameHash: `0x${nameHash.toString(16).padStart(8, "0")}`,
				},
			});
			dataOffset += BigInt(size + 8);
		}
	}
	if (entries.length === 0) {
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v1 archive is empty");
	}
	return { entries, seed };
}

class NekoPack1ArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = nekoPack1Descriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly NekoPack1Entry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: NekoPack1Directory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = {
			version: 1,
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
		const block = await readEncryptedBlock(this.#source, entry.offset);
		return Readable.from([
			block.data.subarray(
				0,
				bigintToBufferLength(entry.size, "NekoPack v1 entry"),
			),
		]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class NekoPack1Format implements ArchiveFormat {
	readonly descriptor = nekoPack1Descriptor;
	readonly detection = { signatures: [{ bytes: NEKOPACK_SIGNATURE }] };
	readonly #knownFileNames: readonly string[];

	constructor(options: NekoPack1Options = {}) {
		this.#knownFileNames = options.knownFileNames ?? [];
	}

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const indexSize = header.readInt32LE(20);
		return (
			header.subarray(0, 8).equals(NEKOPACK_SIGNATURE) &&
			indexSize >= 16 &&
			BigInt(HEADER_SIZE + indexSize) < source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new NekoPack1ArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source, this.#knownFileNames),
		);
	}
}
