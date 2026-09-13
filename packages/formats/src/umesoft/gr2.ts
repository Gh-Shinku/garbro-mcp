// Format reference: GARBro ArcFormats/AdvSys/ArcGR2.cs
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
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
	decodeCStringField,
	isSaneCount,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const SIGNATURE = Buffer.from("PACK", "ascii");
const COUNT_OFFSET = 4;
const DATA_OFFSET_OFFSET = 8;
const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x18;
const NAME_SIZE = 0x10;
const SIZE_OFFSET = 0x10;
const OFFSET_OFFSET = 0x14;
const MIN_DATA_OFFSET = 0x10;
/** Payloads that carry this marker are LL5-compressed behind it. */
const LL5_MARKER = Buffer.from("LL5\0", "latin1");
const EXTENSIONS = new Set(["gr2", "vic", "pac"]);

export const gr2Descriptor: FormatDescriptor = {
	id: "umesoft-gr2",
	name: "Studio Polaris resource archive",
	extensions: ["gr2", "vic", "pac"],
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
			source: "ArcFormats/AdvSys/ArcGR2.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `Gr2Opener.LL5Decompress`: a signed run-length stream where a negative count copies that
 * many literal bytes and a non-negative count repeats the next byte.
 */
export function decompressLl5(input: Buffer): Buffer {
	const chunks: Buffer[] = [];
	let position = 0;
	while (position < input.length) {
		const count = ((input[position] ?? 0) << 24) >> 24;
		position += 1;
		if (count < 0) {
			const length = -count;
			chunks.push(input.subarray(position, position + length));
			position += length;
			continue;
		}
		const value = input[position] ?? 0;
		position += 1;
		chunks.push(Buffer.alloc(count, value));
	}
	return Buffer.concat(chunks);
}

/**
 * GARBro `Gr2Opener.TryOpen`. Records start at 0x10 and are 0x18 bytes wide with a 0x10-byte name,
 * the stored size, and the data offset, which must lie behind the declared data base. Payloads that
 * start with `LL5\0` are expanded with the LL5 run-length scheme.
 *
 * The port expands those payloads while listing, because only then is the unpacked size known and
 * extraction can verify it. Decoded payloads stay in memory for the lifetime of the handle.
 */
async function readGr2Index(
	source: ByteSource,
): Promise<
	{ entries: FixedEntry[]; decoded: Map<string, Buffer> } | undefined
> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const dataOffset = BigInt(header.readUInt32LE(DATA_OFFSET_OFFSET));
	if (dataOffset < BigInt(MIN_DATA_OFFSET) || dataOffset >= source.size)
		return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	const decoded = new Map<string, Buffer>();
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const name = decodeCStringField(index, record, NAME_SIZE);
		const stored = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const offset = BigInt(index.readUInt32LE(record + OFFSET_OFFSET));
		if (offset < dataOffset || !checkPlacement(offset, stored, source.size))
			return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: stored,
		});
		if (stored > BigInt(LL5_MARKER.length)) {
			const marker = await source.readAt(offset, LL5_MARKER.length);
			if (marker.equals(LL5_MARKER)) {
				const payload = await source.readAt(
					offset + BigInt(LL5_MARKER.length),
					Number(stored - BigInt(LL5_MARKER.length)),
				);
				const inflated = decompressLl5(payload);
				decoded.set(entry.id, inflated);
				entry.size = BigInt(inflated.length);
				entry.compressed = true;
				entry.metadata = { ll5: true };
			}
		}
		entries.push(entry);
	}
	return { entries, decoded };
}

class Gr2ArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = gr2Descriptor;
	readonly size: bigint;
	readonly metadata: Record<string, unknown>;
	readonly entries: readonly FixedEntry[];
	readonly #source: ByteSource;
	readonly #decoded: ReadonlyMap<string, Buffer>;

	constructor(
		source: ByteSource,
		sourcePath: string,
		entries: readonly FixedEntry[],
		decoded: ReadonlyMap<string, Buffer>,
	) {
		this.#source = source;
		this.sourcePath = sourcePath;
		this.size = source.size;
		this.entries = entries;
		this.#decoded = decoded;
		this.metadata = {
			entryCount: entries.length,
			decodedEntryCount: decoded.size,
		};
	}

	async openEntry(entryId: string): Promise<Readable> {
		const entry = this.entries.find((candidate) => candidate.id === entryId);
		if (!entry)
			throw new GarbroError(
				"ENTRY_NOT_FOUND",
				`Archive entry not found: ${entryId}`,
			);
		const inflated = this.#decoded.get(entryId);
		if (inflated) return Readable.from([inflated]);
		return this.#source.createReadStream(entry.offset, entry.packedSize);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

export const gr2Format: ArchiveFormat = {
	descriptor: gr2Descriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		if (!EXTENSIONS.has(sourceExtension(sourcePath))) return false;
		return (await readGr2Index(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readGr2Index(source);
		if (!index)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid Studio Polaris GR2 layout",
			);
		return new Gr2ArchiveHandle(
			source,
			sourcePath,
			index.entries,
			index.decoded,
		);
	},
};
