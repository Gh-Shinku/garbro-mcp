// Format reference: GARBro ArcFormats/Artemis/ArcPFS.cs, class `PfsOpener`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { createHash } from "node:crypto";
import {
	GarbroError,
	type ArchiveFormat,
	type ArchiveHandle,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import {
	checkPlacement,
	createFixedEntry,
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

/** Every layout starts with `pf` and a version digit. */
const SIGNATURE = Buffer.from("pf", "latin1");
const VERSION_PF2 = 2;
const VERSION_PF6 = 6;
const VERSION_PF8 = 8;
const INDEX_SIZE_FIELD = 3;
const INDEX_START = 7;

/** `pf6`/`pf8`: the count opens the index, and a record is a length, a name and a four-byte gap. */
const PF_COUNT_IN_INDEX = 4;
const PF_COUNT_FIELD = 7;
const PF_NAME_GAP = 8;
const PF_RECORD_TAIL = 8;

/** `pf2`: the count sits in the file header and the index carries a twelve-byte record gap. */
const PF2_COUNT_FIELD = 0x0b;
const PF2_INDEX_HEADER = 8;
const PF2_RECORD_GAP = 0x10;

interface PfsMetadata extends Record<string, unknown> {
	version: number;
	sha1Key?: string;
}

function pfsMetadata(entry: FixedEntry): PfsMetadata {
	const metadata = entry.metadata ?? {};
	return {
		version: Number(metadata.version ?? 0),
		...(metadata.sha1Key === undefined
			? {}
			: { sha1Key: String(metadata.sha1Key) }),
	};
}

/** GARbro computes the payload key as the SHA-1 hash of the whole index block. */
function indexKey(index: Buffer): Buffer {
	return createHash("sha1").update(index).digest();
}

/**
 * GARBro `PfsOpener.OpenPf`. `pf6` and `pf8` share one layout: the index size is at 0x03, the entry count
 * opens the index, and each record is a 32-bit name length, the name, a four-byte gap and the payload
 * offset and size. `pf8` archives are encrypted with the SHA-1 hash of the index block.
 */
async function readPfIndex(
	source: ByteSource,
	version: number,
): Promise<{ entries: FixedEntry[]; key?: Buffer } | undefined> {
	if (source.size < BigInt(INDEX_START + 4)) return undefined;
	const header = await source.readAt(0n, INDEX_START + 4);
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_FIELD));
	const count = header.readInt32LE(PF_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_START) + indexSize > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_START), Number(indexSize)),
	);

	const entries: FixedEntry[] = [];
	let cursor = PF_COUNT_IN_INDEX;
	for (let id = 0; id < count; id += 1) {
		if (cursor + 4 > index.length) return undefined;
		const nameLength = index.readInt32LE(cursor);
		if (nameLength < 0 || cursor + 4 + nameLength > index.length)
			return undefined;
		const name = decodeCStringField(index, cursor + 4, nameLength);
		cursor += nameLength + PF_NAME_GAP;
		if (cursor + PF_RECORD_TAIL > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(cursor));
		const storedSize = BigInt(index.readUInt32LE(cursor + 4));
		cursor += PF_RECORD_TAIL;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		const metadata: PfsMetadata = { version };
		if (version === VERSION_PF8) metadata.sha1Key = "sha1";
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
				encrypted: version === VERSION_PF8,
				metadata,
			}),
		);
	}
	if (entries.length === 0) return undefined;
	return version === VERSION_PF8
		? { entries, key: indexKey(index) }
		: { entries };
}

/**
 * GARBro `PfsOpener.OpenPf2`. The `pf2` count lives in the file header rather than in the index, and a
 * record carries a twelve-byte gap between its name and the payload fields.
 */
async function readPf2Index(
	source: ByteSource,
): Promise<FixedEntry[] | undefined> {
	if (source.size < BigInt(INDEX_START + 4)) return undefined;
	const header = await source.readAt(0n, PF2_COUNT_FIELD + 4);
	const indexSize = BigInt(header.readUInt32LE(INDEX_SIZE_FIELD));
	const count = header.readInt32LE(PF2_COUNT_FIELD);
	if (!isSaneCount(count)) return undefined;
	if (BigInt(INDEX_START) + indexSize > source.size) return undefined;
	const index = Buffer.from(
		await source.readAt(BigInt(INDEX_START), Number(indexSize)),
	);

	const entries: FixedEntry[] = [];
	let cursor = PF2_INDEX_HEADER;
	for (let id = 0; id < count; id += 1) {
		if (cursor + 4 > index.length) return undefined;
		const nameLength = index.readInt32LE(cursor);
		if (nameLength < 0 || cursor + 4 + nameLength > index.length)
			return undefined;
		const name = decodeCStringField(index, cursor + 4, nameLength);
		cursor += nameLength + PF2_RECORD_GAP;
		if (cursor + PF_RECORD_TAIL > index.length) return undefined;
		const offset = BigInt(index.readUInt32LE(cursor));
		const storedSize = BigInt(index.readUInt32LE(cursor + 4));
		cursor += PF_RECORD_TAIL;
		if (!checkPlacement(offset, storedSize, source.size)) return undefined;
		entries.push(
			createFixedEntry({
				id,
				...normalizeEntryPath(name),
				offset,
				size: storedSize,
				packedSize: storedSize,
				metadata: { version: VERSION_PF2 } satisfies PfsMetadata,
			}),
		);
	}
	return entries.length > 0 ? entries : undefined;
}

/**
 * GARBro `PfsOpener.OpenEntry`. A `pf8` payload is exclusive-ored with the index key, using the absolute
 * file position to index the key, so the key does not restart at the payload. Every other version returns
 * the stored bytes.
 */
class PfsArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = pfsDescriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #key: Buffer | undefined;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: FixedEntry[],
		key?: Buffer,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#key = key;
		const version = pfsMetadata(
			entries[0] ?? ({ metadata: {} } as FixedEntry),
		).version;
		this.metadata = { entryCount: entries.length, version };
	}

	async openEntry(entryId: string): Promise<import("node:stream").Readable> {
		const { Readable } = await import("node:stream");
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const data = Buffer.from(
			await this.#source.readAt(entry.offset, Number(entry.packedSize)),
		);
		if (this.#key)
			for (let position = 0; position < data.length; position += 1)
				data[position] =
					(data[position] ?? 0) ^
					(this.#key[
						Number((entry.offset + BigInt(position)) % BigInt(this.#key.length))
					] ?? 0);
		return Readable.from([data]);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const pfsDescriptor: FormatDescriptor = {
	id: "artemis-pfs",
	name: "Artemis engine resource archive",
	extensions: ["pfs", "000", "001", "002", "003", "004", "005", "010"],
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
			source: "ArcFormats/Artemis/ArcPFS.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `PfsOpener.TryOpen`. The version digit at 0x02 selects the layout: `pf6` and `pf8` share one and
 * `pf2` has its own. Names use the session's code page, which defaults to CP932; the reference's alternate
 * UTF-8 setting and its retry path are not reproduced.
 */
async function readPfsIndex(
	source: ByteSource,
): Promise<{ entries: FixedEntry[]; key?: Buffer } | undefined> {
	if (source.size < 3n) return undefined;
	const header = await source.readAt(0n, 3);
	if (!header.subarray(0, 2).equals(SIGNATURE)) return undefined;
	const version = (header[2] ?? 0) - 0x30;
	switch (version) {
		case VERSION_PF6:
		case VERSION_PF8:
			return readPfIndex(source, version);
		case VERSION_PF2:
			return readPf2Index(source).then((entries) =>
				entries ? { entries } : undefined,
			);
		default:
			return undefined;
	}
}

export const pfsFormat: ArchiveFormat = {
	descriptor: pfsDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readPfsIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readPfsIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Artemis PFS layout");
		return new PfsArchiveHandle(source, sourcePath, index.entries, index.key);
	},
};
