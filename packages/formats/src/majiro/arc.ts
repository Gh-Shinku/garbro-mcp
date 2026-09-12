// Format reference: GARbro ArcFormats/Majiro/ArcMajiro.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import type { Readable } from "node:stream";

const MAJIRO_PREFIX = Buffer.from("MajiroArcV", "ascii");
const HEADER_SIZE = 0x1c;
const MAX_ENTRY_COUNT = 0xfffff;

interface MajiroEntry extends ArchiveEntry {
	offset: bigint;
}

interface MajiroDirectory {
	entries: MajiroEntry[];
	version: number;
}

export const majiroArcDescriptor: FormatDescriptor = {
	id: "majiro-arc",
	name: "Majiro engine resource archive",
	extensions: ["arc"],
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
			source: "ArcFormats/Majiro/ArcMajiro.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function readVersion(header: Buffer): number | undefined {
	if (
		!header.subarray(0, MAJIRO_PREFIX.length).equals(MAJIRO_PREFIX) ||
		!header.subarray(11, 16).equals(Buffer.from(".000\0", "binary"))
	) {
		return undefined;
	}
	const version = (header[10] ?? 0) - 0x30;
	return version >= 1 && version <= 3 ? version : undefined;
}

async function readDirectory(source: ByteSource): Promise<MajiroDirectory> {
	if (source.size < BigInt(HEADER_SIZE)) {
		throw new GarbroError("INVALID_ARCHIVE", "Majiro ARC header is truncated");
	}
	const header = await source.readAt(0n, HEADER_SIZE);
	const version = readVersion(header);
	if (!version) {
		throw new GarbroError("INVALID_ARCHIVE", "Invalid Majiro ARC signature");
	}
	const count = header.readInt32LE(16);
	const namesOffset = header.readUInt32LE(20);
	const dataOffset = header.readUInt32LE(24);
	if (count <= 0 || count > MAX_ENTRY_COUNT) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Majiro ARC entry count is invalid",
		);
	}
	const recordSize = 4 * (version + 1);
	const recordCount = count + (version === 1 ? 1 : 0);
	const tableSize = recordCount * recordSize;
	if (
		!Number.isSafeInteger(tableSize) ||
		namesOffset !== HEADER_SIZE + tableSize ||
		dataOffset <= namesOffset ||
		BigInt(dataOffset) >= source.size
	) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"Majiro ARC section offsets are invalid",
		);
	}
	const [table, names] = await Promise.all([
		source.readAt(BigInt(HEADER_SIZE), tableSize),
		source.readAt(BigInt(namesOffset), dataOffset - namesOffset),
	]);
	let namePosition = 0;
	const entries: MajiroEntry[] = [];
	for (let id = 0; id < count; id += 1) {
		const nameEnd = names.indexOf(0, namePosition);
		if (nameEnd === -1) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Majiro ARC names are truncated",
			);
		}
		const rawPath = decodeCp932(names.subarray(namePosition, nameEnd));
		namePosition = nameEnd + 1;
		if (!rawPath) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Majiro ARC entry has an empty name",
			);
		}
		const recordOffset = id * recordSize;
		const hashSize = version < 3 ? 4 : 8;
		const offset = BigInt(table.readUInt32LE(recordOffset + hashSize));
		let size: bigint;
		if (version === 1) {
			const nextOffset = BigInt(
				table.readUInt32LE(recordOffset + recordSize + hashSize),
			);
			size = nextOffset >= offset ? nextOffset - offset : 0n;
		} else {
			size = BigInt(table.readUInt32LE(recordOffset + hashSize + 4));
		}
		if (
			offset < BigInt(dataOffset) ||
			offset > source.size ||
			size > source.size - offset
		) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				`Majiro ARC entry points outside the archive: ${rawPath}`,
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
			metadata: {
				nameHash:
					version < 3
						? `0x${table.readUInt32LE(recordOffset).toString(16).padStart(8, "0")}`
						: `0x${table.readBigUInt64LE(recordOffset).toString(16).padStart(16, "0")}`,
			},
		});
	}
	return { entries, version };
}

class MajiroArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = majiroArcDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly MajiroEntry[];
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		directory: MajiroDirectory,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = directory.entries;
		this.metadata = { version: directory.version };
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

export class MajiroArcFormat implements ArchiveFormat {
	readonly descriptor = majiroArcDescriptor;
	readonly detection = { signatures: [{ bytes: MAJIRO_PREFIX }] };

	async detect(source: ByteSource): Promise<boolean> {
		if (source.size < BigInt(HEADER_SIZE)) return false;
		const header = await source.readAt(0n, HEADER_SIZE);
		const count = header.readInt32LE(16);
		return (
			readVersion(header) !== undefined && count > 0 && count <= MAX_ENTRY_COUNT
		);
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		return new MajiroArchiveHandle(
			source,
			sourcePath,
			await readDirectory(source),
		);
	}
}
