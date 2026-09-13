// Format reference: GARBro Legacy/Rune/ArcYK.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const HEADER_SIZE = 0x18;
const KEY_OFFSET = 0x10;
const COUNT_OFFSET = 0x14;
const RECORD_SIZE = 12;
const NAMES_ID = 0;
/** Names and payloads are rotated with a key-derived shift. */
const MAX_SHIFT = 7;

export const ykDescriptor: FormatDescriptor = {
	id: "rune-yk",
	name: "Rune resource archive",
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
			source: "Legacy/Rune/ArcYK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

function rotateLeft(value: number, count: number): number {
	const shift = count & 7;
	return ((value << shift) | (value >>> (8 - shift))) & 0xff;
}

/** GARbro `DecryptData`: rotate every byte left by a key-derived amount. */
function decryptData(data: Buffer, key: number): void {
	for (let position = 0; position < data.length; position += 1) {
		const shift =
			Math.imul(Math.imul(Math.imul(92, key), position), position + key) >>> 0;
		data[position] = rotateLeft(
			data[position] ?? 0,
			MAX_SHIFT - (shift % MAX_SHIFT),
		);
	}
}

interface YkRecord {
	offset: bigint;
	size: bigint;
	name: string;
}

async function readYkIndex(
	source: ByteSource,
): Promise<{ records: YkRecord[]; key: number } | undefined> {
	if (source.size < BigInt(HEADER_SIZE)) return undefined;
	const header = await source.readAt(0n, HEADER_SIZE);
	if (
		(header.readUInt32LE(0) |
			header.readUInt32LE(4) |
			header.readUInt32LE(8)) !==
		0
	)
		return undefined;
	const key = header.readInt32LE(KEY_OFFSET);
	const count = header.readInt32LE(COUNT_OFFSET);
	if (count <= 0 || count > 0x3ffff) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(HEADER_SIZE + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(HEADER_SIZE), indexSize);
	const byId = new Map<number, { offset: bigint; size: bigint }>();
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const entryId = index.readInt32LE(record);
		const offset = BigInt(index.readUInt32LE(record + 4));
		const size = BigInt(index.readUInt32LE(record + 8));
		if (!checkPlacement(offset, size, source.size)) return undefined;
		byId.set(entryId, { offset, size });
	}
	const namesEntry = byId.get(NAMES_ID);
	if (!namesEntry) return undefined;
	const names = await source.readAt(namesEntry.offset, Number(namesEntry.size));
	if (key !== 0) decryptData(names, key);

	const namesById = new Map<number, string>();
	let position = 0;
	while (position + 4 <= names.length) {
		const id = names.readInt32LE(position);
		position += 4;
		const terminator = names.indexOf(0, position);
		if (terminator === -1) break;
		namesById.set(id, decodeCp932(names.subarray(position, terminator)));
		position = terminator + 1;
	}

	// GARbro keeps only records that the name blob gave a name to.
	const records: YkRecord[] = [];
	for (const [id, name] of namesById.entries()) {
		if (name.length === 0) continue;
		const record = byId.get(id);
		if (!record) continue;
		records.push({ offset: record.offset, size: record.size, name });
	}
	if (records.length === 0) return undefined;
	return { records, key };
}

class YkArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = ykDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #key: number;

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
		this.#key = key;
		this.metadata = { entryCount: entries.length, key };
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const payload = await this.#source.readAt(entry.offset, Number(entry.size));
		if (this.#key !== 0) decryptData(payload, this.#key);
		return Readable.from([payload]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const ykFormat: ArchiveFormat = {
	descriptor: ykDescriptor,
	async detect(source: ByteSource): Promise<boolean> {
		return (await readYkIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readYkIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Rune YK layout");
		const entries = index.records.map((record, id) =>
			createFixedEntry({
				id,
				...normalizeEntryPath(record.name),
				offset: record.offset,
				size: record.size,
				encrypted: index.key !== 0,
			}),
		);
		return new YkArchiveHandle(source, sourcePath, entries, index.key);
	},
};
