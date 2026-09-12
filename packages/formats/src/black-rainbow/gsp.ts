// Format reference: GARbro ArcFormats/BlackRainbow/ArcGSP.cs
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

const HEADER_SIZE = 4;
const RECORD_SIZE = 0x40;
const NAME_SIZE = 0x38;
const MAX_ENTRY_COUNT = 0xfffff;

interface GspEntry extends ArchiveEntry {
	offset: bigint;
}

export const gspDescriptor: FormatDescriptor = {
	id: "gsp",
	name: "Black Rainbow GSP resource archive",
	extensions: ["gsp"],
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
			source: "ArcFormats/BlackRainbow/ArcGSP.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readEntries(source: ByteSource): Promise<GspEntry[]> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "GSP header is truncated");
	}
	const count = (await source.readAt(0n, HEADER_SIZE)).readInt32LE(0);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "GSP entry count is invalid");
	}
	const indexSize = count * RECORD_SIZE;
	const dataOffset = BigInt(HEADER_SIZE + indexSize);
	if (!Number.isSafeInteger(indexSize) || dataOffset > source.size) {
		throw new GarbroError("INVALID_ARCHIVE", "GSP index is truncated");
	}
	const index = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: GspEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const offset = BigInt(index.readU32LE());
		const size = BigInt(index.readU32LE());
		const rawPath = index.readCString(NAME_SIZE);
		if (!rawPath.trim()) {
			throw new GarbroError("INVALID_ARCHIVE", "GSP entry has an empty name");
		}
		if (
			offset < dataOffset ||
			offset > source.size ||
			size > source.size - offset
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`GSP entry points outside the archive: ${rawPath}`,
			);
		}
		entries.push({
			id: String(id),
			path: rawPath.replaceAll("\\", "/"),
			...(rawPath.includes("\\") ? { rawPath } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: false,
			offset,
		});
	}
	return entries;
}

class GspArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = gspDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = {};
	readonly entries: readonly GspEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: GspEntry[]) {
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

export class GspFormat implements ArchiveFormat {
	readonly descriptor = gspDescriptor;
	readonly detection = { priority: -90 };

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
		return new GspArchiveHandle(source, sourcePath, await readEntries(source));
	}
}
