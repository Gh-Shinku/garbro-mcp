// Format reference: GARBro Legacy/Uran/ArcNCL.cs, class `NclOpener`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
import {
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { extname } from "node:path";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	isSaneCount,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Every payload is stored with this value subtracted from each byte. */
const STREAM_KEY = 10;
/** Method 1 stores the payload; method 2 wraps a zlib stream and method 3 a bzip2 stream. */
const METHOD_STORED = 1;
const METHOD_ZLIB = 2;
const METHOD_BZIP2 = 3;
const MAX_NAME_LENGTH = 0x100;
/** A record opens with two words and the name length, and its tail holds a skippable size word. */
const RECORD_HEADER_SIZE = 10;
const RECORD_TAIL_SIZE = 6;
const TAIL_SIZE_FIELD = 4;

interface NclMetadata extends Record<string, unknown> {
	method: number;
}

function nclMetadata(entry: FixedEntry): NclMetadata {
	const metadata = entry.metadata ?? {};
	return { method: Number(metadata.method ?? METHOD_STORED) };
}

/**
 * GARBro `NclOpener.TryOpen`. Records are walked one after another from the start of the file: two words and a
 * name length, the name, a six-byte tail with a size word, the method byte and the payload. The walk ends at a
 * zero size word, and the entry's stored length covers the method byte as well.
 */
async function readNcl(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (extname(sourcePath).toLowerCase() !== ".ncl") return undefined;
	if (source.size > 0xffffffffn) return undefined;

	const entries: FixedEntry[] = [];
	let offset = 0n;
	while (offset < source.size) {
		// The zero size word that ends the walk only needs its own four bytes, so it is read first.
		if (offset + 4n > source.size) return undefined;
		if ((await source.readAt(offset, 4)).readUInt32LE(0) === 0) break;
		if (offset + BigInt(RECORD_HEADER_SIZE) > source.size) return undefined;
		const header = await source.readAt(offset, RECORD_HEADER_SIZE);
		const storedSize = BigInt(header.readUInt32LE(0));
		const unpackedSize = BigInt(header.readUInt32LE(4));
		const nameLength = header.readUInt16LE(8);
		if (nameLength === 0 || nameLength > MAX_NAME_LENGTH) return undefined;
		if (offset + BigInt(RECORD_HEADER_SIZE + nameLength) > source.size)
			return undefined;
		const name = decodeCStringField(
			await source.readAt(offset + BigInt(RECORD_HEADER_SIZE), nameLength),
			0,
			nameLength,
		);
		offset += BigInt(RECORD_HEADER_SIZE + nameLength);
		if (offset + BigInt(RECORD_TAIL_SIZE) > source.size) return undefined;
		const tail = await source.readAt(offset, RECORD_TAIL_SIZE);
		const tailSize = tail.readUInt16LE(TAIL_SIZE_FIELD);
		offset += BigInt(RECORD_TAIL_SIZE + tailSize);
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const method =
			(((await source.readAt(offset, 1))[0] ?? 0) - STREAM_KEY) & 0xff;
		const packed = method !== METHOD_STORED;
		entries.push(
			createFixedEntry({
				id: entries.length,
				path: name,
				offset: offset + 1n,
				size: packed ? unpackedSize : storedSize - 1n,
				packedSize: storedSize - 1n,
				compressed: packed,
				metadata: { method } satisfies NclMetadata,
			}),
		);
		offset += storedSize;
	}
	return entries.length > 0 ? entries : undefined;
}

/** GARBro `NclSubStream`: every byte of the stored range has the stream key subtracted from it. */
function decodeSubStream(data: Buffer): Buffer {
	const output = Buffer.from(data);
	for (let i = 0; i < output.length; i += 1)
		output[i] = ((output[i] ?? 0) - STREAM_KEY) & 0xff;
	return output;
}

class NclArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = uranNclDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;

	constructor(source: ByteSource, sourcePath: string, entries: FixedEntry[]) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.metadata = { entryCount: entries.length };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const data = decodeSubStream(
			Buffer.from(
				await this.#source.readAt(entry.offset, Number(entry.packedSize)),
			),
		);
		const method = nclMetadata(entry).method;
		if (!entry.compressed) return Readable.from([data]);
		if (method === METHOD_ZLIB)
			return Readable.from([await inflateZlibBuffer(data)]);
		if (method === METHOD_BZIP2)
			throw new GarbroError(
				"UNSUPPORTED_FEATURE",
				"Uran NCL bzip2 payloads are not supported",
			);
		// Any other packed method falls through to the decoded stream, like the reference.
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const uranNclDescriptor: FormatDescriptor = {
	id: "uran-ncl",
	name: "Uran resource archive",
	extensions: ["ncl"],
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
			source: "Legacy/Uran/ArcNCL.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const uranNclFormat: ArchiveFormat = {
	descriptor: uranNclDescriptor,
	// The format has no signature and is gated by the extension and the record walk.
	detection: { signatures: [], extensionFallback: true },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		try {
			return (await readNcl(source, sourcePath)) !== undefined;
		} catch {
			return false;
		}
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const entries = await readNcl(source, sourcePath);
		if (!entries)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Uran NCL layout");
		return new NclArchiveHandle(source, sourcePath, entries);
	},
};
