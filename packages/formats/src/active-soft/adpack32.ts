// Format reference: GARbro ArcFormats/ActiveSoft/ArcADPACK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	BufferCursor,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import type { Readable } from "node:stream";

const ADPACK32_SIGNATURE = Buffer.from("ADPACK32", "ascii");
const HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x18;
const MAX_ENTRY_COUNT = 0xfffff;

interface Adpack32Entry extends ArchiveEntry {
	offset: bigint;
}

export const adpack32Descriptor: FormatDescriptor = {
	id: "adpack32",
	name: "Active Soft ADPACK32 archive",
	extensions: ["pak"],
	capabilities: {
		detect: true,
		list: true,
		extract: true,
		create: false,
		encryption: false,
	},
	attribution: [
		{
			project: "GARbro",
			source: "ArcFormats/ActiveSoft/ArcADPACK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readEntryCount(source: ByteSource): Promise<number> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "ADPACK32 header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (
		!header.subarray(0, ADPACK32_SIGNATURE.length).equals(ADPACK32_SIGNATURE)
	) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid ADPACK32 signature");
	}
	const storedCount = header.readUInt32LE(12);
	if (storedCount <= 1 || storedCount - 1 > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "ADPACK32 entry count is invalid");
	}
	return storedCount - 1;
}

async function readEntries(source: ByteSource): Promise<Adpack32Entry[]> {
	const entryCount = await readEntryCount(source);
	const recordCount = entryCount + 1;
	const indexSize = recordCount * RECORD_SIZE;
	const dataOffset = BigInt(HEADER_SIZE + indexSize);
	if (dataOffset > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "ADPACK32 index is truncated");
	}
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const cursor = new BufferCursor(index);
	const offsets: bigint[] = [];
	const names: string[] = [];

	for (let indexPosition = 0; indexPosition < recordCount; indexPosition += 1) {
		const name = cursor.readCString(NAME_SIZE);
		cursor.skip(4);
		const offset = BigInt(cursor.readU32LE());
		if (indexPosition < entryCount) names.push(name);
		offsets.push(offset);
	}

	const entries: Adpack32Entry[] = [];
	for (let indexPosition = 0; indexPosition < entryCount; indexPosition += 1) {
		const path = names[indexPosition] ?? "";
		const offset = offsets[indexPosition] ?? 0n;
		const nextOffset = offsets[indexPosition + 1] ?? 0n;
		if (!path.trim()) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"ADPACK32 entry has an empty name",
			);
		}
		if (
			offset < dataOffset ||
			nextOffset < offset ||
			nextOffset > source.size
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`ADPACK32 entry points outside the archive: ${path}`,
			);
		}
		const size = nextOffset - offset;
		entries.push({
			id: String(indexPosition),
			path: path.replaceAll("\\", "/"),
			...(path.includes("\\") ? { rawPath: path } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: false,
			offset,
		});
	}
	return entries;
}

class Adpack32ArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = adpack32Descriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly Adpack32Entry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: Adpack32Entry[],
	) {
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
		return this.#source.createReadStream(entry.offset, entry.size);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export class Adpack32Format implements ArchiveFormat {
	readonly descriptor = adpack32Descriptor;
	readonly detection = {
		signatures: [{ bytes: ADPACK32_SIGNATURE }],
	};

	async detect(source: ByteSource): Promise<boolean> {
		try {
			await readEntryCount(source);
			return true;
		} catch (error) {
			if (error instanceof GarbroError && error.code === "INVALID_ARCHIVE")
				return false;
			throw error;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new Adpack32ArchiveHandle(
			source,
			sourcePath,
			await readEntries(source),
		);
	}
}
