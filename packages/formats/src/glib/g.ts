// Format reference: GARbro ArcFormats/GLib/ArcG.cs, class `GOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	type ArchiveEntry,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
	decodeCp932,
	GarbroError,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	isSaneCount,
	normalizeEntryPath,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("GML_", "latin1");
const HEADER_SIZE = 0x14;
/** The unpacked index starts with a 256 byte substitution table. */
const KEY_SIZE = 256;
/** Every record carries the payload's first four bytes. */
const ENTRY_HEADER_SIZE = 4;
/** Guard for the attacker-controlled unpacked index size. */
const MAX_INDEX_SIZE = 0x40000000;

interface GmlRecord {
	offset: bigint;
	size: bigint;
	name: string;
	header: Buffer;
}

interface GmlIndex {
	key: Buffer;
	records: GmlRecord[];
}

/**
 * GARbro `GOpener.TryOpen`. The archive holds a packed index that starts at 0x14. The packed bytes are
 * exclusive-ored with 0xFF and then run through GARbro's default LZSS variant, which uses a set bit as
 * a literal and a sixteen bit match whose high nibble is the distance's bits 8 to 11 and whose low
 * nibble is the length beyond three.
 *
 * The unpacked index is a 256 byte substitution table, an entry count, and then records of a name
 * length, the name, a payload offset relative to the data offset in the header, the stored size, and
 * the payload's first four bytes.
 */
async function readGmlIndex(source: ByteSource): Promise<GmlIndex | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (!header.subarray(0, 4).equals(SIGNATURE)) return undefined;
	if (header.subarray(4, 8).toString("latin1") !== "ARC\0") return undefined;
	const dataOffset = BigInt(header.readUInt32LE(8));
	const unpackedSize = header.readUInt32LE(0x0c);
	const packedSize = header.readUInt32LE(0x10);
	if (unpackedSize < KEY_SIZE + 4 || unpackedSize > MAX_INDEX_SIZE)
		return undefined;
	if (
		BigInt(HEADER_SIZE) + BigInt(packedSize) > source.size ||
		packedSize === 0
	)
		return undefined;

	const packed = await source.readAt(BigInt(HEADER_SIZE), packedSize);
	const decoded = Buffer.from(packed);
	for (let index = 0; index < decoded.length; index += 1)
		decoded[index] = (decoded[index] ?? 0) ^ 0xff;
	const index = inflateLzss(decoded, { outputLength: unpackedSize });
	if (index.length < KEY_SIZE + 4) return undefined;

	const key = Buffer.from(index.subarray(0, KEY_SIZE));
	const count = index.readInt32LE(KEY_SIZE);
	if (!isSaneCount(count)) return undefined;

	let position = KEY_SIZE + 4;
	const records: GmlRecord[] = [];
	for (let id = 0; id < count; id += 1) {
		if (position + 4 > index.length) return undefined;
		const nameLength = index.readInt32LE(position);
		position += 4;
		if (
			nameLength < 0 ||
			position + nameLength + 8 + ENTRY_HEADER_SIZE > index.length
		)
			return undefined;
		const nameField = index.subarray(position, position + nameLength);
		const terminator = nameField.indexOf(0);
		const name = decodeCp932(
			terminator === -1 ? nameField : nameField.subarray(0, terminator),
		);
		position += nameLength;
		const offset = BigInt(index.readUInt32LE(position)) + dataOffset;
		const size = BigInt(index.readUInt32LE(position + 4));
		position += 8;
		const entryHeader = Buffer.from(
			index.subarray(position, position + ENTRY_HEADER_SIZE),
		);
		position += ENTRY_HEADER_SIZE;
		if (
			offset >= source.size ||
			size > source.size ||
			offset > source.size - size
		)
			return undefined;
		records.push({ offset, size, name, header: entryHeader });
	}
	if (records.length === 0) return undefined;
	return { key, records };
}

/**
 * GARbro `GOpener.OpenEntry`. The stored payload passes through the archive's substitution table,
 * byte by byte, from its fifth byte onwards; its first four bytes are copied back out of the index.
 * The reference copies all four bytes unconditionally, so a shorter payload is an error rather than a
 * partially restored one.
 */
class GmlArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = glibGDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly ArchiveEntry[];
	readonly #source: ByteSource;
	readonly #key: Buffer;
	readonly #headers: readonly Buffer[];

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: readonly ArchiveEntry[],
		index: GmlIndex,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#key = index.key;
		this.#headers = index.records.map((record) => record.header);
		this.metadata = { entryCount: entries.length };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const position = this.entries.findIndex((entry) => entry.id === entryId);
		const entry = this.entries[position];
		if (!entry) {
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		}
		const payload = Buffer.from(
			await this.#source.readAt(
				(entry as ArchiveEntry & { offset: bigint }).offset,
				Number(entry.size),
			),
		);
		const header = this.#headers[position];
		if (!header || payload.length < ENTRY_HEADER_SIZE)
			throw new GarbroError("INVALID_ARCHIVE", "Truncated GLib payload");
		for (let index = ENTRY_HEADER_SIZE; index < payload.length; index += 1)
			payload[index] = this.#key[payload[index] ?? 0] ?? 0;
		header.copy(payload, 0);
		return Readable.from([payload]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const glibGDescriptor: FormatDescriptor = {
	id: "glib-g",
	name: "GLib engine resource archive",
	extensions: ["g", "xp"],
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
			source: "ArcFormats/GLib/ArcG.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const glibGFormat: ArchiveFormat = {
	descriptor: glibGDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readGmlIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readGmlIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid GLib archive layout");
		const entries = index.records.map((record, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset: record.offset,
				size: record.size,
			}),
		);
		return new GmlArchiveHandle(source, sourcePath, entries, index);
	},
};
