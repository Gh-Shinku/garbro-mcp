// Format reference: GARbro ArcFormats/Nekopack/ArcNEKO3.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	bigintToBufferLength,
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";

const NEKOPACK_SIGNATURE = Buffer.from("NEKOPACK", "ascii");
const HEADER_SIZE = 0x41c;
const KEY_SIZE = 0x400;
const MAX_ENTRY_COUNT = 0xfffff;

interface NekoPack3Entry extends ArchiveEntry {
	offset: bigint;
	seed: number;
}

interface NekoPack3Directory {
	entries: NekoPack3Entry[];
	key: Buffer;
	keySeed: number;
}

export const nekoPack3Descriptor: FormatDescriptor = {
	id: "nekopack-3",
	name: "NekoPack version 3 resource archive",
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
			source: "ArcFormats/Nekopack/ArcNEKO3.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export function decryptNekoPack3Data(
	data: Buffer,
	key: Buffer,
	initialSeed: number,
	initialize = false,
): void {
	let seed = initialSeed & 0xffff;
	for (let offset = 0; offset + 4 <= data.length; offset += 4) {
		const source = data.readUInt32LE(offset);
		seed = (seed + 0xc3) & 0x1ff;
		const value = (source ^ key.readUInt32LE(seed)) >>> 0;
		seed = (seed + ((initialize ? source : value) & 0xffff)) & 0xffff;
		data.writeUInt32LE(value, offset);
	}
}

export function initializeNekoPack3Key(
	encryptedKey: Uint8Array,
	seed: number,
): Buffer {
	if (encryptedKey.byteLength !== KEY_SIZE) {
		throw new RangeError("NekoPack v3 key must contain exactly 1024 bytes");
	}
	const key = Buffer.from(encryptedKey);
	let count = (seed % 7) + 3;
	while (count > 0) {
		decryptNekoPack3Data(key, key, seed, true);
		count -= 1;
	}
	return key;
}

async function readDirectory(source: ByteSource): Promise<NekoPack3Directory> {
	if (source.size <= BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "NekoPack v3 header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 8).equals(NEKOPACK_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid NekoPack v3 signature");
	}
	const keySeed = header.readUInt32LE(12);
	const key = initializeNekoPack3Key(
		header.subarray(16, 16 + KEY_SIZE),
		keySeed,
	);
	const indexSeed = header.readUInt16LE(0x410);
	const indexInfo = Buffer.from(header.subarray(0x414, 0x41c));
	decryptNekoPack3Data(indexInfo, key, indexSeed);
	const indexSize = indexInfo.readUInt32LE(0);
	if (
		indexSize < 4 ||
		indexSize !== indexInfo.readUInt32LE(4) ||
		BigInt(HEADER_SIZE + indexSize) >= source.size
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"NekoPack v3 index size is invalid",
		);
	}
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	decryptNekoPack3Data(index, key, indexSeed);
	const cursor = new BufferCursor(index);
	const directoryCount = cursor.readI32LE();
	if (directoryCount <= 0 || directoryCount > MAX_ENTRY_COUNT) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"NekoPack v3 directory count is invalid",
		);
	}
	const dataOffset = BigInt(HEADER_SIZE + indexSize);
	const entries: NekoPack3Entry[] = [];
	for (
		let directoryIndex = 0;
		directoryIndex < directoryCount;
		directoryIndex += 1
	) {
		const directoryLength = cursor.readU8();
		const directory = cursor.readCString(directoryLength);
		if (!directory) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"NekoPack v3 directory name is empty",
			);
		}
		const fileCount = cursor.readI32LE();
		if (
			fileCount <= 0 ||
			fileCount > MAX_ENTRY_COUNT ||
			entries.length + fileCount > MAX_ENTRY_COUNT
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"NekoPack v3 file count is invalid",
			);
		}
		for (let fileIndex = 0; fileIndex < fileCount; fileIndex += 1) {
			cursor.readU8();
			const nameLength = cursor.readU8();
			const name = cursor.readCString(nameLength);
			if (!name)
				throw new GarbroError(
					"INVALID_ARCHIVE",
					"NekoPack v3 filename is empty",
				);
			const blockOffset = dataOffset + BigInt(cursor.readU32LE());
			if (blockOffset < dataOffset || blockOffset + 12n > source.size) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`NekoPack v3 entry header is outside the archive: ${directory}/${name}`,
				);
			}
			const blockHeader = await source.readAt(blockOffset, 12);
			const seed = blockHeader.readUInt16LE(0);
			const sizes = Buffer.from(blockHeader.subarray(4));
			decryptNekoPack3Data(sizes, key, seed);
			const size = sizes.readUInt32LE(0);
			if (BigInt(size) > source.size - blockOffset - 12n) {
				throw new GarbroError(
					"INVALID_ARCHIVE",
					`NekoPack v3 entry data is truncated: ${directory}/${name}`,
				);
			}
			entries.push({
				id: String(entries.length),
				path: `${directory}/${name}`.replaceAll("\\", "/"),
				size: BigInt(size),
				packedSize: BigInt(size + 12),
				compressed: false,
				encrypted: true,
				offset: blockOffset + 12n,
				seed,
				metadata: { relativeOffset: (blockOffset - dataOffset).toString() },
			});
		}
	}
	return { entries, key, keySeed };
}

class NekoPack3ArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = nekoPack3Descriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly NekoPack3Entry[];
	readonly #source: ByteSource;
	readonly #key: Buffer;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: NekoPack3Directory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.#key = directory.key;
		this.metadata = {
			version: 3,
			keySeed: `0x${directory.keySeed.toString(16).padStart(8, "0")}`,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const data = await this.#source.readAt(
			entry.offset,
			bigintToBufferLength(entry.size, "NekoPack v3 entry"),
		);
		decryptNekoPack3Data(data, this.#key, entry.seed);
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class NekoPack3Format implements ArchiveFormat {
	readonly descriptor = nekoPack3Descriptor;
	readonly detection = {
		signatures: [{ bytes: NEKOPACK_SIGNATURE }],
		priority: 2,
	};

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size <= BigInt(HEADER_SIZE)) return false;
		try {
			const header = await source.readAt(0n, HEADER_SIZE);
			if (!header.subarray(0, 8).equals(NEKOPACK_SIGNATURE)) return false;
			const keySeed = header.readUInt32LE(12);
			const key = initializeNekoPack3Key(
				header.subarray(16, 16 + KEY_SIZE),
				keySeed,
			);
			const info = Buffer.from(header.subarray(0x414));
			decryptNekoPack3Data(info, key, header.readUInt16LE(0x410));
			const size = info.readUInt32LE(0);
			return (
				size >= 4 &&
				size === info.readUInt32LE(4) &&
				BigInt(HEADER_SIZE + size) < source.size
			);
		} catch {
			return false;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new NekoPack3ArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
		);
	}
}
