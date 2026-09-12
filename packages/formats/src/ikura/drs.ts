// Format reference: GARbro ArcFormats/Ikura/ArcDRS.cs
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

const RECORD_SIZE = 0x10;
const NAME_SIZE = 12;
const MIN_DIRECTORY_SIZE = 0x20;
const MAX_ARCHIVE_SIZE = 0xffffffffn;

interface DrsEntry extends ArchiveEntry {
	offset: bigint;
}

export const drsDescriptor: FormatDescriptor = {
	id: "drs",
	name: "Digital Romance System resource archive",
	extensions: ["", "dat", "snr"],
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
			source: "ArcFormats/Ikura/ArcDRS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readEntries(source: ByteSource): Promise<DrsEntry[]> {
	if (source.size > MAX_ARCHIVE_SIZE || source.size < 2n) {
		throw new GarbroError("INVALID_ARCHIVE", "DRS archive size is invalid");
	}
	const directorySize = (await source.readAt(0n, 2)).readUInt16LE(0);
	const dataFloor = BigInt(directorySize + 2);
	if (
		directorySize < MIN_DIRECTORY_SIZE ||
		(directorySize & 0x0f) !== 0 ||
		dataFloor >= source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "DRS directory size is invalid");
	}
	const directory = await source.readAt(2n, directorySize);
	if ((directory[0] ?? 0) <= 0x20) {
		throw new GarbroError("INVALID_ARCHIVE", "DRS first filename is invalid");
	}
	const count = directorySize / RECORD_SIZE - 1;
	const entries: DrsEntry[] = [];
	let offset = BigInt(directory.readUInt32LE(NAME_SIZE));
	if (offset < dataFloor || offset > source.size) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"DRS first data offset is invalid",
		);
	}
	for (let index = 0; index < count; index += 1) {
		const recordOffset = index * RECORD_SIZE;
		const record = new BufferCursor(
			directory.subarray(recordOffset, recordOffset + RECORD_SIZE),
		);
		const rawPath = record.readCString(NAME_SIZE);
		if (!rawPath) {
			throw new GarbroError("INVALID_ARCHIVE", "DRS entry has an empty name");
		}
		const nextOffset = BigInt(
			directory.readUInt32LE(recordOffset + RECORD_SIZE + NAME_SIZE),
		);
		if (nextOffset < offset || nextOffset > source.size) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`DRS entry points outside the archive: ${rawPath}`,
			);
		}
		const size = nextOffset - offset;
		entries.push({
			id: String(index),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: false,
			offset,
		});
		offset = nextOffset;
	}
	return entries;
}

class DrsArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = drsDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly DrsEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: DrsEntry[]) {
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

export class DrsFormat implements ArchiveFormat {
	readonly descriptor = drsDescriptor;
	readonly detection = { priority: -100 };

	async detect(source: ByteSource): Promise<boolean> {
		try {
			await readEntries(source);
			return true;
		} catch (error) {
			if (error instanceof GarbroError && error.code === "INVALID_ARCHIVE") {
				return false;
			}
			throw error;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new DrsArchiveHandle(source, sourcePath, await readEntries(source));
	}
}
