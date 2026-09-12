// Format reference: GARbro ArcFormats/Cri/ArcSPC.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateLzss } from "@garbro-mcp/codecs";
import {
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	GarbroError,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { basename, extname } from "node:path";
import { Readable } from "node:stream";

const XTX_SIGNATURE = 0x00787478; // 'xtx' plus a NUL byte, read as a little-endian word.
const HEADER_SIZE = 4;
const RECORD_SIZE = 0x10;
const MINIMUM_ENTRY_SIZE = 0x20;
const MAXIMUM_UNPACKED_SIZE = 0x5000000;
const MAXIMUM_DEPTH = 0x20;

export const spcDescriptor: FormatDescriptor = {
	id: "cri-spc",
	name: "CRI MiddleWare texture container",
	extensions: ["spc"],
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
			source: "ArcFormats/Cri/ArcSPC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

interface SpcEntry extends ArchiveEntry {
	offset: bigint;
}

async function parseUnpackedSize(
	source: ByteSource,
): Promise<number | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const size = (await source.readAt(0n, HEADER_SIZE)).readUInt32LE(0);
	if (size <= MINIMUM_ENTRY_SIZE || size > MAXIMUM_UNPACKED_SIZE)
		return undefined;
	return size;
}

function readIndex(
	index: Buffer,
	baseOffset: number,
	directoryName: string,
	baseName: string,
	entries: SpcEntry[],
	depth: number,
): void {
	if (depth > MAXIMUM_DEPTH) {
		throw new GarbroError(
			"INVALID_ARCHIVE",
			"CRI SPC subdirectory nesting is too deep",
		);
	}
	if (baseOffset + 4 > index.length) {
		throw new GarbroError("INVALID_ARCHIVE", "CRI SPC index is truncated");
	}
	const firstOffset = index.readUInt32LE(baseOffset);
	if (firstOffset === 0 || (firstOffset & 0xf) !== 0) {
		throw new GarbroError("INVALID_ARCHIVE", "CRI SPC index size is invalid");
	}
	const count = firstOffset / RECORD_SIZE;
	if (baseOffset + firstOffset > index.length) {
		throw new GarbroError("INVALID_ARCHIVE", "CRI SPC index is truncated");
	}
	const records: { offset: number; size: number }[] = [];
	for (let id = 0; id < count; id += 1) {
		const recordOffset = baseOffset + id * RECORD_SIZE;
		const offset = index.readUInt32LE(recordOffset);
		const size = index.readUInt32LE(recordOffset + 4);
		if (offset < firstOffset || size < MINIMUM_ENTRY_SIZE) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"CRI SPC record layout is invalid",
			);
		}
		records.push({ offset: baseOffset + offset, size });
	}
	for (const record of records) {
		if (record.offset + 4 > index.length) {
			throw new GarbroError("INVALID_ARCHIVE", "CRI SPC entry is truncated");
		}
		if (index.readUInt32LE(record.offset) === XTX_SIGNATURE) {
			const name = `${baseName}#${String(entries.length).padStart(4, "0")}.xtx`;
			entries.push({
				id: String(entries.length),
				path: directoryName ? `${directoryName}/${name}` : name,
				size: BigInt(record.size),
				packedSize: BigInt(record.size),
				compressed: false,
				encrypted: false,
				offset: BigInt(record.offset),
			});
		} else {
			const subdirectory = `${directoryName ? `${directoryName}/` : ""}${String(
				entries.length,
			).padStart(4, "0")}`;
			readIndex(
				index,
				record.offset,
				subdirectory,
				baseName,
				entries,
				depth + 1,
			);
		}
	}
}

class SpcArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = spcDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly SpcEntry[];
	readonly #index: Buffer;
	readonly #source: ByteSource;

	constructor(
		source: ByteSource,
		sourcePath: string,
		index: Buffer,
		entries: SpcEntry[],
	) {
		this.#source = source;
		this.#index = index;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = {
			entryCount: entries.length,
			unpackedSize: index.length,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		const start = Number(entry.offset);
		return Readable.from([
			this.#index.subarray(start, start + Number(entry.size)),
		]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const spcFormat = new (class implements ArchiveFormat {
	readonly descriptor = spcDescriptor;
	readonly detection = { extensionFallback: true };

	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (extname(sourcePath).slice(1).toLowerCase() !== "spc") return false;
		return (await parseUnpackedSize(source)) !== undefined;
	}

	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const unpackedSize = await parseUnpackedSize(source);
		if (unpackedSize === undefined) {
			throw new GarbroError("INVALID_ARCHIVE", "Invalid CRI SPC layout");
		}
		const compressed = await source.readAt(
			BigInt(HEADER_SIZE),
			Number(source.size - BigInt(HEADER_SIZE)),
		);
		const index = inflateLzss(compressed, { outputLength: unpackedSize });
		if (index.length !== unpackedSize) {
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"CRI SPC LZSS stream ended before the declared size",
			);
		}
		const entries: SpcEntry[] = [];
		readIndex(
			index,
			0,
			"",
			basename(sourcePath, extname(sourcePath)),
			entries,
			0,
		);
		if (entries.length === 0) {
			throw new GarbroError("INVALID_ARCHIVE", "CRI SPC archive is empty");
		}
		return new SpcArchiveHandle(source, sourcePath, index, entries);
	}
})();
