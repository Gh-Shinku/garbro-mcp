// Format reference: GARBro ArcFormats/Ads/ArcPAC.cs, classes `PacOpener`, `IndexReader`,
// `RleDecompressor` and `AdsEntry`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	decodeCp932,
	GarbroError,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { Readable } from "node:stream";
import {
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	sourceExtension,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const EXTENSION = "pac";
const INDEX_SIZE_OFFSET = 0;
const MIN_INDEX_SIZE = 0x110;
/** The root directory begins after the index size word. */
const ROOT_OFFSET = 4;
const DIRECTORY_COUNT_LIMIT = 0x200;
const FILE_COUNT_LIMIT = 0x40000;
/** Every name occupies a fixed slot, and its bytes are stored bitwise inverted. */
const NAME_SLOT_SIZE = 0x104;
const NAME_MASK = 0xff;
const METHOD_STORED = 0;
const METHOD_RLE = 1;
/** The RLE pattern is three bytes wide and repeats by a stored count minus one. */
const PATTERN_SIZE = 3;
const COUNT_SIZE = 4;
const RLE_CHUNK_SIZE = 8;

export const adsPacDescriptor: FormatDescriptor = {
	id: "ads-pac",
	name: "ads engine resource archive",
	extensions: [EXTENSION],
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
			source: "ArcFormats/Ads/ArcPAC.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARBro `PacOpener`'s `RleDecompressor`. A stream of chunks starts with a control byte: zero means a
 * literal run whose length is however many bytes the next read returned, at most three, while a non-zero
 * value repeats the pattern left in that three-byte buffer a stored count minus one times.
 *
 * The reference reuses the same buffer for both branches, so a literal run shorter than three bytes
 * leaves stale pattern bytes for a later repeat, and the port keeps that behavior. The decompressor
 * carries no declared output length, so the stream decides where the output ends.
 */
function unpackAdsRle(input: Buffer): Buffer {
	const pattern = Buffer.alloc(RLE_CHUNK_SIZE);
	let output = Buffer.alloc(0x1000);
	let length = 0;
	let source = 0;
	let patternSize = PATTERN_SIZE;
	const push = (value: number): void => {
		if (length === output.length) {
			const grown = Buffer.alloc(output.length * 2);
			output.copy(grown, 0, 0, length);
			output = grown;
		}
		output[length++] = value;
	};
	while (source < input.length) {
		const control = input[source++];
		if (control === undefined) break;
		if (control !== 0) {
			if (source + COUNT_SIZE > input.length) break;
			const count = input.readUInt32LE(source) - 1;
			source += COUNT_SIZE;
			for (let repetition = 0; repetition < count; repetition += 1) {
				for (let index = 0; index < patternSize; index += 1)
					push(pattern[index] ?? 0);
			}
		} else {
			const available = Math.min(3, input.length - source);
			if (available <= 0) break;
			for (let index = 0; index < available; index += 1)
				pattern[index] = input[source + index] ?? 0;
			patternSize = available;
			source += available;
			for (let index = 0; index < patternSize; index += 1)
				push(pattern[index] ?? 0);
		}
	}
	return output.subarray(0, length);
}

/**
 * GARBro `IndexReader`. The index region is `[0, index_size)` where the size comes from the first word,
 * and the directory tree starts at offset 4. A directory begins with a count of subdirectories and a
 * count of files; only the root carries a name, which the reference reads and then discards.
 *
 * Every name occupies a fixed 0x104-byte slot whose bytes are stored inverted, and the reader consumes
 * the whole slot, which is what pins the record stride. A file record then adds the stored size, the
 * data offset, which is validated against the volume rather than the index, and the compression method.
 * A subdirectory record adds the offset of its own directory, validated against the index length, and
 * its name. Names are joined with a forward slash, and both counts are bounded.
 */
class AdsIndexReader {
	readonly #index: Buffer;
	readonly #archiveSize: bigint;
	readonly #entries: FixedEntry[] = [];

	constructor(index: Buffer, archiveSize: bigint) {
		this.#index = index;
		this.#archiveSize = archiveSize;
	}

	readIndex(): FixedEntry[] | undefined {
		return this.#readDirectory(ROOT_OFFSET, "") ? this.#entries : undefined;
	}

	#readName(position: number): { name: string; end: number } {
		const end = Math.min(position + NAME_SLOT_SIZE, this.#index.length);
		const slot = this.#index.subarray(position, end);
		const terminator = slot.indexOf(0);
		const limit = terminator === -1 ? slot.length : terminator;
		const decoded = Buffer.alloc(limit);
		for (let index = 0; index < limit; index += 1)
			decoded[index] = (slot[index] ?? 0) ^ NAME_MASK;
		return { name: decodeCp932(decoded), end };
	}

	#readDirectory(offset: number, directoryName: string): boolean {
		if (offset + 8 > this.#index.length) return false;
		const directoryCount = this.#index.readInt32LE(offset);
		const fileCount = this.#index.readInt32LE(offset + 4);
		if (directoryCount < 0 || directoryCount > DIRECTORY_COUNT_LIMIT)
			return false;
		if (fileCount < 0 || fileCount > FILE_COUNT_LIMIT) return false;
		let position = offset + 8;
		if (directoryName.length === 0) {
			const root = this.#readName(position);
			position = root.end;
			if (root.name.trim().length === 0) return false;
		}

		for (let index = 0; index < fileCount; index += 1) {
			const read = this.#readName(position);
			position = read.end;
			if (read.name.trim().length === 0) return false;
			if (position + 12 > this.#index.length) return false;
			const storedSize = BigInt(this.#index.readUInt32LE(position));
			const dataOffset = BigInt(this.#index.readUInt32LE(position + 4));
			const method = this.#index.readInt32LE(position + 8);
			position += 12;
			if (dataOffset + storedSize > this.#archiveSize) return false;
			const path =
				directoryName.length === 0
					? read.name
					: `${directoryName}/${read.name}`;
			const packed = method !== METHOD_STORED;
			const entry: FixedEntry = createFixedEntry({
				id: this.#entries.length,
				...normalizeEntryPath(path),
				offset: dataOffset,
				size: storedSize,
				packedSize: storedSize,
				compressed: packed,
				metadata: { compressionMethod: method },
			});
			// An RLE payload declares no output length, so its stored span is not the extracted length.
			if (method === METHOD_RLE) entry.sizeKnown = false;
			this.#entries.push(entry);
		}

		const directories: { offset: number; name: string }[] = [];
		for (let index = 0; index < directoryCount; index += 1) {
			if (position + 4 > this.#index.length) return false;
			const childOffset = this.#index.readUInt32LE(position);
			position += 4;
			const read = this.#readName(position);
			position = read.end;
			if (read.name.trim().length === 0) return false;
			if (childOffset >= this.#index.length) return false;
			directories.push({
				offset: childOffset,
				name:
					directoryName.length === 0
						? read.name
						: `${directoryName}/${read.name}`,
			});
		}
		for (const child of directories) {
			if (!this.#readDirectory(child.offset, child.name)) return false;
		}
		return true;
	}
}

/**
 * GARBro `PacOpener.TryOpen`. The archive needs a `pac` extension and an index region at least 0x110
 * bytes long that ends inside the volume, whose length every data offset is validated against.
 *
 * Extraction only decompresses method one. Any other non-zero method leaves the payload verbatim even
 * though the reference still calls it packed, and the port keeps that distinction.
 */
async function readAdsIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<FixedEntry[] | undefined> {
	if (sourceExtension(sourcePath) !== EXTENSION) return undefined;
	if (source.size < 4n) return undefined;
	const indexSize = BigInt(
		(await source.readAt(0n, 4)).readUInt32LE(INDEX_SIZE_OFFSET),
	);
	if (indexSize < BigInt(MIN_INDEX_SIZE) || indexSize >= source.size)
		return undefined;
	const index = await source.readAt(0n, Number(indexSize));
	const entries = new AdsIndexReader(index, source.size).readIndex();
	if (!entries || entries.length === 0) return undefined;
	return entries;
}

/** GARBro `PacOpener.OpenEntry`: only method one is RLE packed. */
async function openAdsEntry(
	source: ByteSource,
	entry: FixedEntry,
): Promise<Readable> {
	const method =
		typeof entry.metadata?.compressionMethod === "number"
			? entry.metadata.compressionMethod
			: METHOD_STORED;
	const stored = await source.readAt(entry.offset, Number(entry.packedSize));
	if (method !== METHOD_RLE) return Readable.from([stored]);
	return Readable.from([unpackAdsRle(stored)]);
}

export const adsPacFormat: ArchiveFormat = defineFixedArchive({
	descriptor: adsPacDescriptor,
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readAdsIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const entries = await readAdsIndex(source, sourcePath);
		if (!entries)
			throw new GarbroError(
				"INVALID_ARCHIVE",
				"Invalid ads PAC archive layout",
			);
		return { entries, metadata: { entryCount: entries.length } };
	},
	openEntry: openAdsEntry,
});
