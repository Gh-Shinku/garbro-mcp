// Format reference: GARbro ArcFormats/Cri/ArcAFS.cs
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

const AFS_SIGNATURE = Buffer.from([0x41, 0x46, 0x53, 0x00]);
const HEADER_SIZE = 8;
const INDEX_RECORD_SIZE = 8;
const NAME_RECORD_SIZE = 0x30;
const NAME_SIZE = 0x20;
const ALIGNMENT = 0x800n;
const MAX_ENTRY_COUNT = 0xfffff;

interface AfsEntry extends ArchiveEntry {
	offset: bigint;
}

export const afsDescriptor: FormatDescriptor = {
	id: "afs",
	name: "CRI AFS archive",
	extensions: ["afs"],
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
			source: "ArcFormats/Cri/ArcAFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function alignOffset(value: bigint): bigint {
	return (value + ALIGNMENT - 1n) & -ALIGNMENT;
}

async function readEntries(source: ByteSource): Promise<AfsEntry[]> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "AFS header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 4).equals(AFS_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid AFS signature");
	}
	const count = header.readInt32LE(4);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "AFS entry count is invalid");
	}
	const indexSize = count * INDEX_RECORD_SIZE;
	if (
		!Number.isSafeInteger(indexSize) ||
		BigInt(HEADER_SIZE + indexSize) > source.size
	) {
		throw new GarbroError("INVALID_ARCHIVE", "AFS index is truncated");
	}
	const cursor = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const placements: Array<{ offset: bigint; size: bigint }> = [];
	for (let index = 0; index < count; index += 1) {
		const offset = BigInt(cursor.readU32LE());
		const size = BigInt(cursor.readU32LE());
		if (offset > source.size || size > source.size - offset) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"AFS entry points outside the archive",
			);
		}
		placements.push({ offset, size });
	}

	const last = placements[placements.length - 1];
	if (!last) throw new GarbroError("INVALID_ARCHIVE", "AFS has no entries");
	const namesOffset = alignOffset(last.offset + last.size);
	const namesSize = count * NAME_RECORD_SIZE;
	if (
		namesOffset > source.size ||
		BigInt(namesSize) > source.size - namesOffset
	) {
		throw new GarbroError("INVALID_ARCHIVE", "AFS filename table is truncated");
	}
	const names = new BufferCursor(await source.readAt(namesOffset, namesSize));
	return placements.map(({ offset, size }, index) => {
		const path = names.readCString(NAME_SIZE);
		names.skip(NAME_RECORD_SIZE - NAME_SIZE);
		if (!path) {
			throw new GarbroError("INVALID_ARCHIVE", "AFS entry has an empty name");
		}
		return {
			id: String(index),
			path: path.replaceAll("\\", "/"),
			...(path.includes("\\") ? { rawPath: path } : {}),
			size,
			packedSize: size,
			compressed: false,
			encrypted: false,
			offset,
		};
	});
}

class AfsArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = afsDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown> = { alignment: "2048" };
	readonly entries: readonly AfsEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: AfsEntry[]) {
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

export class AfsFormat implements ArchiveFormat {
	readonly descriptor = afsDescriptor;
	readonly detection = { signatures: [{ bytes: AFS_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(4);
		return (
			header.subarray(0, 4).equals(AFS_SIGNATURE) &&
			count > 0 &&
			count <= MAX_ENTRY_COUNT
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new AfsArchiveHandle(source, sourcePath, await readEntries(source));
	}
}
