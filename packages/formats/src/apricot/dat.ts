// Format reference: GARBro ArcFormats/Apricot/ArcDAT.cs, class `Mpf2Opener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	FileByteSource,
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { existsSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { Readable } from "node:stream";
import { changeExtension } from "../shared/companion.js";
import {
	createFixedEntry,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";
import { openMultiPartStream } from "../shared/multi-part.js";

const SIGNATURE = Buffer.from("MPF2", "latin1");
/** The packed index length and the payload base offset. */
const INDEX_LENGTH_FIELD = 8;
const DATA_OFFSET_FIELD = 0x10;
const INDEX_START = 0x20;
/** The fields a record opens with, before the 500 bytes the reader skips. */
const RECORD_FIELDS_SIZE = 28;
/** A record header, including the 500 bytes the reader skips, before the name. */
const RECORD_HEADER_SIZE = 528;
const ENTRY_LENGTH_FIELD = 0;
const DELETED_FIELD = 4;
const OFFSET_FIELD = 8;
const SIZE_FIELD = 0x14;
const UNPACKED_FIELD = 0x18;
/** Sibling parts run from `.a01` to `.a99`. */
const MAX_PARTS = 99;
const PART_DIGITS = 2;

/**
 * GARBro `Mpf2Opener.TryOpen`. A zlib index sits at 0x20 and unpacks to a sequence of records; every record
 * declares its own length, so the walk ends with the index. Deleted records are skipped, and a record whose
 * payload lies outside the virtual file space is skipped as well instead of declining the archive. Payload
 * offsets are relative to the header's data offset.
 */
async function readApricotDat(
	source: ByteSource,
	sourcePath: string,
): Promise<
	| { entries: FixedEntry[]; totalSize: bigint; parts: FileByteSource[] }
	| undefined
> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const indexLength = header.readUInt32LE(INDEX_LENGTH_FIELD);
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_FIELD));
	if (indexLength === 0) return undefined;
	if (BigInt(INDEX_START + indexLength) > source.size) return undefined;

	let index: Buffer;
	try {
		index = await inflateZlibBuffer(
			Buffer.from(await source.readAt(BigInt(INDEX_START), indexLength)),
		);
	} catch {
		return undefined;
	}

	// The parts continue the virtual offset space behind the archive itself.
	const parts: FileByteSource[] = [];
	const directory = dirname(sourcePath);
	const base = changeExtension(sourcePath, "");
	for (let number = 1; number <= MAX_PARTS; number += 1) {
		const name = `${base}.a${String(number).padStart(PART_DIGITS, "0")}`;
		const path = resolve(directory, name);
		if (!existsSync(path)) break;
		try {
			parts.push(await FileByteSource.open(path));
		} catch {
			break;
		}
	}
	let totalSize = source.size;
	for (const part of parts) totalSize += part.size;

	const entries: FixedEntry[] = [];
	let cursor = 0;
	while (cursor < index.length) {
		if (cursor + RECORD_FIELDS_SIZE > index.length) {
			await Promise.all(parts.map((part) => part.close()));
			return undefined;
		}
		const entryLength = index.readInt32LE(cursor + ENTRY_LENGTH_FIELD);
		// A record that cannot hold a name rejects the whole index.
		if (entryLength <= RECORD_HEADER_SIZE) {
			await Promise.all(parts.map((part) => part.close()));
			return undefined;
		}
		const deleted = index.readUInt32LE(cursor + DELETED_FIELD) !== 0;
		const offset = index.readBigInt64LE(cursor + OFFSET_FIELD) + dataOffset;
		const storedSize = BigInt(index.readUInt32LE(cursor + SIZE_FIELD));
		const unpackedSize = BigInt(index.readUInt32LE(cursor + UNPACKED_FIELD));
		// The name follows the skipped bytes. Like the reference's short stream reads, a truncated final
		// record yields only the bytes that exist, which can be an empty name.
		const nameStart = Math.min(cursor + RECORD_HEADER_SIZE, index.length);
		const nameLength = Math.max(
			0,
			Math.min(entryLength - RECORD_HEADER_SIZE, index.length - nameStart),
		);
		const name = index
			.subarray(nameStart, nameStart + nameLength)
			.toString("utf16le");
		cursor += entryLength;
		if (deleted || offset + storedSize > totalSize) continue;
		const packed = storedSize !== unpackedSize;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size: packed ? unpackedSize : storedSize,
				packedSize: storedSize,
				compressed: packed,
			}),
		);
	}
	return { entries, totalSize, parts };
}

class ApricotArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = apricotDatDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #parts: readonly FileByteSource[];

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: FixedEntry[],
		totalSize: bigint,
		parts: FileByteSource[],
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#parts = parts;
		this.metadata = {
			entryCount: entries.length,
			partCount: parts.length,
			totalSize,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const input = openMultiPartStream(
			[this.#source, ...this.#parts],
			entry.offset,
			entry.packedSize,
		);
		if (!entry.compressed) return input;
		return Readable.from([await inflateBuffer(input)]);
	}

	async close(): Promise<void> {
		await Promise.all(this.#parts.map((part) => part.close()));
		await this.#source.close();
	}
}

async function inflateBuffer(input: Readable): Promise<Buffer> {
	const chunks: Buffer[] = [];
	for await (const chunk of input)
		chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
	return inflateZlibBuffer(Buffer.concat(chunks));
}

export const apricotDatDescriptor: FormatDescriptor = {
	id: "apricot-dat",
	name: "Apricot resource archive",
	extensions: [],
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
			source: "ArcFormats/Apricot/ArcDAT.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const apricotDatFormat: ArchiveFormat = {
	descriptor: apricotDatDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			const result = await readApricotDat(source, sourcePath);
			if (!result) return false;
			await Promise.all(result.parts.map((part) => part.close()));
			return true;
		} catch {
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const result = await readApricotDat(source, sourcePath);
		if (!result)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Apricot DAT layout");
		return new ApricotArchiveHandle(
			source,
			sourcePath,
			result.entries,
			result.totalSize,
			result.parts,
		);
	},
};
