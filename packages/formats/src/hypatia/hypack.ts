// Format reference: GARbro ArcFormats/Hypatia/ArcKogado.cs
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
import { decompressMariel } from "./mariel.js";

const HYPACK_SIGNATURE = Buffer.from("HyPack", "ascii");
const HEADER_SIZE = 0x10;
const MAX_ENTRY_COUNT = 0xfffff;

const versionRecordSizes = new Map<number, number>([
	[0x100, 0x20],
	[0x200, 0x28],
	[0x300, 0x30],
	[0x301, 0x30],
]);

interface HyPackEntry extends ArchiveEntry {
	offset: bigint;
	compressionType: number;
}

interface HyPackDirectory {
	entries: HyPackEntry[];
	version: number;
}

export const hyPackDescriptor: FormatDescriptor = {
	id: "hypack",
	name: "Kogado HyPack resource archive",
	extensions: ["pak", "dat"],
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
			source: "ArcFormats/Hypatia/ArcKogado.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readDirectory(source: ByteSource): Promise<HyPackDirectory> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "HyPack header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 6).equals(HYPACK_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid HyPack signature");
	}
	const version = header.readUInt16LE(6);
	const recordSize = versionRecordSizes.get(version);
	if (!recordSize) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			`Unsupported HyPack version: 0x${version.toString(16)}`,
		);
	}
	const indexOffset = BigInt(HEADER_SIZE + header.readUInt32LE(8));
	const count = header.readInt32LE(12);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "HyPack entry count is invalid");
	}
	const indexSize = count * recordSize;
	if (
		indexOffset >= source.size ||
		!Number.isSafeInteger(indexSize) ||
		BigInt(indexSize) > source.size - indexOffset
	) {
		throw new GarbroError("INVALID_ARCHIVE", "HyPack index is truncated");
	}
	const index = new BufferCursor(await source.readAt(indexOffset, indexSize));
	const entries: HyPackEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		let name = index.readCString(0x15);
		const extension = index.readCString(3);
		if (!name) name = id.toString().padStart(5, "0");
		if (extension) name += `.${extension}`;
		const offset = BigInt(HEADER_SIZE + index.readU32LE());
		let size: bigint;
		let packedSize: bigint;
		let compressionType = 0;
		const metadata: Record<string, unknown> = {
			version: `0x${version.toString(16)}`,
		};
		if (version >= 0x200) {
			size = BigInt(index.readU32LE());
			packedSize = BigInt(index.readU32LE());
			compressionType = index.readU8();
			if (version >= 0x300) {
				metadata.hasChecksum = index.readU8() !== 0;
				metadata.checksum = `0x${index.readU16LE().toString(16).padStart(4, "0")}`;
				metadata.fileTime = index.readI64LE().toString();
			} else {
				index.skip(3);
			}
		} else {
			packedSize = BigInt(index.readU32LE());
			size = packedSize;
		}
		if (compressionType > 3) size = packedSize;
		if (offset > source.size || packedSize > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`HyPack entry points outside the archive: ${name}`,
			);
		}
		entries.push({
			id: String(id),
			path: name,
			size,
			packedSize,
			compressed: compressionType === 1 || compressionType === 2,
			encrypted: compressionType === 3,
			offset,
			compressionType,
			metadata: { ...metadata, compressionType },
		});
	}
	return { entries, version };
}

class HyPackArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = hyPackDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly HyPackEntry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: HyPackDirectory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = { version: `0x${directory.version.toString(16)}` };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (entry.compressionType === 0 || entry.compressionType > 3) {
			return this.#source.createReadStream(entry.offset, entry.packedSize);
		}
		if (entry.compressionType === 2) {
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				`Cocotte-compressed HyPack entry is not supported: ${entry.path}`,
			);
		}
		const data = await this.#source.readAt(
			entry.offset,
			bigintToBufferLength(entry.packedSize, "HyPack entry"),
		);
		if (entry.compressionType === 3) {
			for (let index = 0; index < data.length; index += 1) {
				data[index] = (data[index] ?? 0) ^ 0xff;
			}
			return Readable.from([data]);
		}
		return Readable.from([
			decompressMariel(data, bigintToBufferLength(entry.size, "Mariel output")),
		]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class HyPackFormat implements ArchiveFormat {
	readonly descriptor = hyPackDescriptor;
	readonly detection = { signatures: [{ bytes: HYPACK_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const recordSize = versionRecordSizes.get(header.readUInt16LE(6));
		const count = header.readInt32LE(12);
		return (
			header.subarray(0, 6).equals(HYPACK_SIGNATURE) &&
			recordSize !== undefined &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new HyPackArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
		);
	}
}
