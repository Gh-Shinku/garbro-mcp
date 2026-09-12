// Format reference: GARbro ArcFormats/ArcPACKDAT.cs
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

const PACKDAT_SIGNATURE = Buffer.from("PACKDAT.", "ascii");
const HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
const ENCRYPTED_FLAG = 0x10000;
const MAX_ENTRY_COUNT = 0xfffff;

interface PackDatEntry extends ArchiveEntry {
	offset: bigint;
	flags: number;
	script: boolean;
}

export const packDatDescriptor: FormatDescriptor = {
	id: "packdat",
	name: "SYSTEM-epsilon PACKDAT resource archive",
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
			source: "ArcFormats/ArcPACKDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function rotateLeft32(value: number, count: number): number {
	if (count === 0) return value >>> 0;
	return ((value << count) | (value >>> (32 - count))) >>> 0;
}

function decodeEntry(data: Buffer, flags: number, script: boolean): void {
	if ((flags & ENCRYPTED_FLAG) !== 0) {
		let key = data.length >>> 2;
		key = (key ^ (key << ((key & 7) + 8))) >>> 0;
		for (let offset = 0; offset + 4 <= data.length; offset += 4) {
			const value = (data.readUInt32LE(offset) ^ key) >>> 0;
			data.writeUInt32LE(value, offset);
			key = rotateLeft32(key, value % 24);
		}
	}
	if (script) {
		for (let index = 0; index < data.length; index += 1) {
			data[index] = (data[index] ?? 0) ^ 0xff;
		}
	}
}

async function readEntries(source: ByteSource): Promise<PackDatEntry[]> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "PACKDAT header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 8).equals(PACKDAT_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid PACKDAT signature");
	}
	const count = header.readInt32LE(8);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "PACKDAT entry count is invalid");
	}
	const indexSize = count * RECORD_SIZE;
	if (
		!Number.isSafeInteger(indexSize) ||
		BigInt(HEADER_SIZE + indexSize) > source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "PACKDAT index is truncated");
	}
	const index = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: PackDatEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const rawPath = index.readCString(NAME_SIZE);
		const offset = BigInt(index.readU32LE());
		const flags = index.readU32LE();
		const size = BigInt(index.readU32LE());
		const declaredUnpackedSize = BigInt(index.readU32LE());
		if (!rawPath) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"PACKDAT entry has an empty name",
			);
		}
		if (offset > source.size || size > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`PACKDAT entry points outside the archive: ${rawPath}`,
			);
		}
		const script = rawPath.toLowerCase().endsWith(".s");
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: (flags & ENCRYPTED_FLAG) !== 0 || script,
			offset,
			flags,
			script,
			metadata: {
				flags: `0x${flags.toString(16)}`,
				declaredUnpackedSize: declaredUnpackedSize.toString(),
			},
		});
	}
	return entries;
}

class PackDatArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = packDatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly PackDatEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: PackDatEntry[]) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		if (!entry.encrypted) {
			return this.#source.createReadStream(entry.offset, entry.size);
		}
		const data = await this.#source.readAt(
			entry.offset,
			bigintToBufferLength(entry.size, "PACKDAT entry"),
		);
		decodeEntry(data, entry.flags, entry.script);
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class PackDatFormat implements ArchiveFormat {
	readonly descriptor = packDatDescriptor;
	readonly detection = { signatures: [{ bytes: PACKDAT_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(8);
		return (
			header.subarray(0, 8).equals(PACKDAT_SIGNATURE) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT &&
			BigInt(HEADER_SIZE + count * RECORD_SIZE) <= source.size
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new PackDatArchiveHandle(
			source,
			sourcePath,
			await readEntries(source),
		);
	}
}
