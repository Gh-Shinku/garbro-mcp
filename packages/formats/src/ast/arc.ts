// Format reference: GARbro ArcFormats/ArcAST.cs, class `ArcOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { inflateLzssAll } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** 'ARC2' and 'ARC1'; the fourth byte doubles as the version. */
const ARC2_SIGNATURE = Buffer.from("ARC2", "latin1");
const ARC1_SIGNATURE = Buffer.from("ARC1", "latin1");
const INDEX_START = 8;
/** A record is the unpacked size, a name length and the name. */
const RECORD_HEADER_SIZE = 9;
/** The PNG signature exclusive-ored with 0xFF, which is how version 2 stores them. */
const XORED_PNG_SIGNATURE = 0xb8b1af76;
/** Version 2 masks every name byte, and payloads, with 0xFF. */
const XOR_MASK = 0xff;

interface AstIndex {
	entries: FixedEntry[];
	version: number;
}

/**
 * GARbro `ArcOpener.TryOpen`. 'ARC1' and 'ARC2' archives share one layout, and the fourth byte of the
 * marker is the version.
 *
 * Records are walked from 0x08 and an entry's stored size is the gap to the next record's offset — a
 * zero next offset means the unpacked size is also the stored size, and the last record runs to the end
 * of the file. A record whose offset is zero or the end of the file is a placeholder and is skipped,
 * and version 2 masks every name byte with 0xFF.
 */
async function readAstIndex(source: ByteSource): Promise<AstIndex | undefined> {
	if (source.size < BigInt(INDEX_START)) return undefined;
	const header = await source.readAt(0n, INDEX_START);
	if (
		!header.subarray(0, 4).equals(ARC2_SIGNATURE) &&
		!header.subarray(0, 4).equals(ARC1_SIGNATURE)
	)
		return undefined;
	const version = (header[3] ?? 0) - 0x30;
	const count = header.readInt32LE(4);
	if (!isSaneCount(count)) return undefined;

	const entries: FixedEntry[] = [];
	let indexOffset = BigInt(INDEX_START);
	// The first record's offset precedes the first record's own fields.
	let nextOffset = BigInt(
		(await source.readAt(indexOffset, 4)).readUInt32LE(0),
	);
	for (let id = 0; id < count; id += 1) {
		if (indexOffset + BigInt(RECORD_HEADER_SIZE) > source.size)
			return undefined;
		const record = await source.readAt(indexOffset, RECORD_HEADER_SIZE);
		const offset = nextOffset;
		const unpackedSize = BigInt(record.readUInt32LE(4));
		const nameLength = record[8] ?? 0;
		const nameStart = indexOffset + BigInt(RECORD_HEADER_SIZE);
		if (nameStart + BigInt(nameLength) > source.size) return undefined;
		const nameField = await source.readAt(nameStart, nameLength);
		if (id + 1 === count) {
			nextOffset = source.size;
		} else {
			const nextStart = nameStart + BigInt(nameLength);
			if (nextStart + 4n > source.size) return undefined;
			nextOffset = BigInt((await source.readAt(nextStart, 4)).readUInt32LE(0));
		}
		if (offset !== 0n && offset !== source.size) {
			if (version === 2)
				for (let position = 0; position < nameLength; position += 1)
					nameField[position] = (nameField[position] ?? 0) ^ XOR_MASK;
			let storedSize: bigint;
			if (nextOffset === 0n) storedSize = unpackedSize;
			else if (nextOffset >= offset) storedSize = nextOffset - offset;
			else return undefined;
			const name = decodeCp932(nameField);
			if (!checkPlacement(offset, storedSize, source.size)) return undefined;
			// Only version 2 archives are decoded, so a version 1 entry is stored as it is.
			const compressed = version === 2 && storedSize !== unpackedSize;
			entries.push(
				createFixedEntry({
					id: entries.length,
					...normalizeEntryPath(name),
					offset,
					size: compressed ? unpackedSize : storedSize,
					packedSize: storedSize,
					compressed,
					metadata: { version },
				}),
			);
		}
		indexOffset = nameStart + BigInt(nameLength);
	}
	if (entries.length === 0) return undefined;
	return { entries, version };
}

/**
 * GARbro `ArcOpener.OpenEntry`, which only decodes payloads for version 2 archives. A stored payload
 * whose first four bytes are the exclusive-ored PNG signature is un-masked as a whole, and a packed one
 * runs through GARbro's default LZSS variant with a 0xFF ring buffer fill, followed by the same
 * exclusive-or.
 */
class AstArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = astArcDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #version: number;

	constructor(source: ByteSource, sourcePath: string, index: AstIndex) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = index.entries;
		this.#version = index.version;
		this.metadata = {
			entryCount: index.entries.length,
			version: index.version,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const stored = Buffer.from(
			await this.#source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (this.#version !== 2) return Readable.from([stored]);
		if (!entry.compressed) {
			if (stored.length >= 4 && stored.readUInt32LE(0) === XORED_PNG_SIGNATURE)
				for (let index = 0; index < stored.length; index += 1)
					stored[index] = (stored[index] ?? 0) ^ XOR_MASK;
			return Readable.from([stored]);
		}
		const unpacked = inflateLzssAll(stored, { frameFill: XOR_MASK });
		for (let index = 0; index < unpacked.length; index += 1)
			unpacked[index] = (unpacked[index] ?? 0) ^ XOR_MASK;
		return Readable.from([unpacked]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const astArcDescriptor: FormatDescriptor = {
	id: "ast-arc",
	name: "AST script engine resource archive",
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
			source: "ArcFormats/ArcAST.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const astArcFormat: ArchiveFormat = {
	descriptor: astArcDescriptor,
	detection: {
		signatures: [{ bytes: ARC1_SIGNATURE }, { bytes: ARC2_SIGNATURE }],
	},
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAstIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readAstIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AST archive layout");
		return new AstArchiveHandle(source, sourcePath, index);
	},
};
