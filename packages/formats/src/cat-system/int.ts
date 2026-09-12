// Format reference: GARbro ArcFormats/CatSystem/ArcINT.cs
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

const KIF_SIGNATURE = Buffer.from([0x4b, 0x49, 0x46, 0x00]);
const ENCRYPTED_MARKER = Buffer.from("__key__.dat\0", "binary");
const HEADER_SIZE = 8;
const RECORD_SUFFIX_SIZE = 8;
const NAME_SIZES = [0x20, 0x40] as const;
const MAX_ENTRY_COUNT = 0xfffff;

interface IntEntry extends ArchiveEntry {
	offset: bigint;
}

interface IntDirectory {
	entries: IntEntry[];
	nameSize: number;
}

export const intDescriptor: FormatDescriptor = {
	id: "cat-system-int",
	name: "CatSystem2 KIF resource archive",
	extensions: ["int"],
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
			source: "ArcFormats/CatSystem/ArcINT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

async function readHeader(source: ByteSource): Promise<{
	count: number;
	encrypted: boolean;
}> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "KIF header is truncated");
	}
	const probeLength = Number(source.size < 20n ? source.size : 20n);
	const header = await source.readAt(0n, probeLength);
	if (!header.subarray(0, 4).equals(KIF_SIGNATURE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid KIF signature");
	}
	const count = header.readInt32LE(4);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError("INVALID_ARCHIVE", "KIF entry count is invalid");
	}
	return {
		count,
		encrypted:
			header.length >= 20 && header.subarray(8, 20).equals(ENCRYPTED_MARKER),
	};
}

async function tryReadDirectory(
	source: ByteSource,
	count: number,
	nameSize: number,
): Promise<IntEntry[] | undefined> {
	const recordSize = nameSize + RECORD_SUFFIX_SIZE;
	const indexSize = count * recordSize;
	if (
		!Number.isSafeInteger(indexSize) ||
		BigInt(HEADER_SIZE + indexSize) > source.size
	) {
		return undefined;
	}
	const index = new BufferCursor(
		await source.readAt(BigInt(HEADER_SIZE), indexSize),
	);
	const entries: IntEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const rawPath = index.readCString(nameSize);
		if (!rawPath) return undefined;
		const offsetField = HEADER_SIZE + index.position;
		const offset = BigInt(index.readU32LE());
		const size = BigInt(index.readU32LE());
		if (
			offset <= BigInt(offsetField) ||
			offset > source.size ||
			size > source.size - offset
		) {
			return undefined;
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

async function readDirectory(source: ByteSource): Promise<IntDirectory> {
	const header = await readHeader(source);
	if (header.encrypted) {
		throw new GarbroError(
			"UNSUPPORTED_FEATURE",
			"Encrypted KIF archives require a game-specific main key",
		);
	}
	for (const nameSize of NAME_SIZES) {
		const entries = await tryReadDirectory(source, header.count, nameSize);
		if (entries && entries.length > 0) return { entries, nameSize };
	}
	throw new GarbroError("INVALID_ARCHIVE", "KIF index is invalid");
}

class IntArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = intDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly IntEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, directory: IntDirectory) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = { nameSize: directory.nameSize };
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

export class IntFormat implements ArchiveFormat {
	readonly descriptor = intDescriptor;
	readonly detection = { signatures: [{ bytes: KIF_SIGNATURE }] };

	async detect(source: ByteSource): Promise<boolean> {
		try {
			await readHeader(source);
			return true;
		} catch (error) {
			if (error instanceof GarbroError && error.code === "INVALID_ARCHIVE") {
				return false;
			}
			throw error;
		}
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new IntArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
		);
	}
}
