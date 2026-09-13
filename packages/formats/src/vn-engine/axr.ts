// Format reference: GARbro ArcFormats/VnEngine/ArcAXR.cs, class `AxrOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("AXRe", "latin1");
const HEADER_SIZE = 0x10;
/** The payload keystream repeats every 0x400 bytes. */
const KEY_TABLE_SIZE = 0x400;

/** GARbro `Binary.RotByteR`. */
function rotateByteRight(value: number, count: number): number {
	return ((value >>> count) | (value << (8 - count))) & 0xff;
}

/** GARbro `AxrOpener.MutateKey`, with uint wraparound kept. */
function mutateKey(key: number): number {
	let value = key >>> 0;
	value = (value ^ (((value & 0xfff) << 17) >>> 0)) >>> 0;
	const rotated = (((value << 18) >>> 0) | (value >>> 15)) >>> 0;
	return ~(value ^ rotated) >>> 0;
}

/**
 * GARbro `AxrOpener.Decrypt`: a word-wise stream cipher whose key schedule feeds on the plaintext, so
 * the same routine decrypts with the archive key and, run over a zero buffer, builds the payload
 * keystream. The reference only decrypts whole groups of four bytes.
 */
function decryptWords(data: Buffer, key: number): void {
	let cursor = key >>> 0;
	for (let offset = 0; offset + 4 <= data.length; offset += 4) {
		cursor = mutateKey(cursor);
		const value = (data.readUInt32LE(offset) ^ cursor) >>> 0;
		data.writeUInt32LE(value, offset);
		cursor = (cursor + value) >>> 0;
	}
}

/**
 * GARbro `AxrArchive`: a 0x400 byte payload keystream, built by running the index cipher over an empty
 * buffer with the archive key, whose words advance by their own value.
 */
export function buildAxrKeyTable(key: number): Buffer {
	const table = Buffer.alloc(KEY_TABLE_SIZE);
	decryptWords(table, key);
	return table;
}

interface AxrIndex {
	entries: FixedEntry[];
	key: number;
}

/**
 * GARbro `AxrOpener.TryOpen`. The header holds a key at 0x04, a seed at 0x08 and a checksum word at
 * 0x0C. The index size is `MutateKey(MutateKey(seed ^ signature)) ^ key`, and the header checksum is
 * an exclusive-or of the eight bytes from 0x04, each rotated right by its distance from the first.
 *
 * The index is read from 0x10, padded up to a whole number of words, decrypted in place, and then
 * walked: every record is an absolute offset, a size, and a CP932 name padded to a word boundary. An
 * empty name ends the walk, and the reference writes a zero byte just past the index so that a name
 * that runs to the very end still terminates.
 */
async function readAxrIndex(source: ByteSource): Promise<AxrIndex | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	const key = header.readUInt32LE(4);
	const seed = header.readUInt32LE(8);
	const t = mutateKey(mutateKey((seed ^ header.readUInt32LE(0)) >>> 0));
	const indexSize = (t ^ key) >>> 0;
	const storedChecksum = (header.readUInt32LE(12) ^ mutateKey(t)) >>> 0;
	let checksum = header[4] ?? 0;
	for (let index = 1; index < 8; index += 1)
		checksum ^= rotateByteRight(header[4 + index] ?? 0, index);
	if (indexSize < 8 || checksum !== storedChecksum) return undefined;
	// The reference reads the index into a buffer rounded up to a word and reports a short read.
	const roundedSize = Number((BigInt(indexSize) + 4n) & ~3n);
	if (BigInt(HEADER_SIZE) + BigInt(indexSize) > source.size) return undefined;
	const raw = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const index = Buffer.alloc(roundedSize);
	raw.copy(index);
	decryptWords(index, key);
	index[indexSize] = 0;

	const entries: FixedEntry[] = [];
	let cursor = 0;
	while (cursor + 8 < indexSize) {
		const offset = BigInt(index.readUInt32LE(cursor));
		const size = BigInt(index.readUInt32LE(cursor + 4));
		cursor += 8;
		const terminator = index.indexOf(0, cursor);
		// The reference would hand a negative length to the CP932 decoder and throw.
		if (terminator === -1) return undefined;
		const nameLength = terminator - cursor;
		if (nameLength === 0) break;
		const name = decodeCp932(index.subarray(cursor, terminator));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id: entries.length,
				...normalizeEntryPath(name),
				offset,
				size,
				encrypted: true,
			}),
		);
		cursor += (nameLength + 4) & ~3;
	}
	if (entries.length === 0) return undefined;
	return { entries, key };
}

/**
 * GARbro `AxrEncryptedStream`. Payload bytes are exclusive-ored with the key table at their **absolute**
 * archive offset, wrapping every 0x400 bytes; the reference reads the underlying stream's position,
 * which is the entry's offset rather than a position within the entry.
 */
class AxrArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = vnEngineAxrDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #table: Buffer;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: readonly FixedEntry[],
		key: number,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#table = buildAxrKeyTable(key);
		this.metadata = { entryCount: entries.length };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const payload = Buffer.from(
			await this.#source.readAt(entry.offset, Number(entry.size)),
		);
		const start = Number(entry.offset);
		for (let index = 0; index < payload.length; index += 1)
			payload[index] =
				(payload[index] ?? 0) ^ (this.#table[(start + index) & 0x3ff] ?? 0);
		return Readable.from([payload]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const vnEngineAxrDescriptor: FormatDescriptor = {
	id: "vnengine-axr",
	name: "GEM/vnengine resource archive",
	extensions: [],
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
			source: "ArcFormats/VnEngine/ArcAXR.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const vnEngineAxrFormat: ArchiveFormat = {
	descriptor: vnEngineAxrDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readAxrIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readAxrIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid AXR archive layout");
		return new AxrArchiveHandle(source, sourcePath, index.entries, index.key);
	},
};
