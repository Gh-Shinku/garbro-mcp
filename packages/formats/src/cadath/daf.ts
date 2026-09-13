// Format reference: GARbro ArcFormats/Cadath/ArcDAF.cs (with DecryptSnr and CgfDecoder.Decrypt from ImageCGF.cs)
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { inflateZlibBuffer } from "@garbro-mcp/codecs";
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

const SIGNATURE = Buffer.from("DAF\x1a", "latin1");
const COUNT_OFFSET = 4;
const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x18;
const SIZE_OFFSET = 4;
const NAME_OFFSET = 8;
const SNR_EXTENSION = "snr";
const SNR_MARKER = Buffer.from("SNR\x1a", "latin1");
const SNR_HEADER_SIZE = 12;
/** The SNR payload stores a 32-bit checksum behind its header; the zlib stream follows it. */
const SNR_ZLIB_OFFSET = 4;
const SNR_KEY_START = 0x84;
const SNR_KEY_STEP = 0x99;
const CGF_SEED = 0x3977141b;

export const dafDescriptor: FormatDescriptor = {
	id: "cadath-daf",
	name: "Cadath resource archive",
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
			source: "ArcFormats/Cadath/ArcDAF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
		{
			project: "GARbro",
			source: "ArcFormats/Cadath/ImageCGF.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

/**
 * GARbro `DafOpener.DecryptSnr`: a rolling subtraction whose key advances a variable number of times
 * per byte, derived from the low nibble of the position.
 */
function decryptSnr(data: Buffer): void {
	let key = SNR_KEY_START;
	for (let position = 0; position < data.length; position += 1) {
		data[position] = ((data[position] ?? 0) - key) & 0xff;
		for (
			let count = Math.floor(((position & 0xf) + 2) / 3);
			count > 0;
			count -= 1
		) {
			key = (key + SNR_KEY_STEP) & 0xff;
		}
	}
}

function rotateLeft(value: number, count: number): number {
	return ((value << count) | (value >>> (32 - count))) >>> 0;
}

/**
 * GARbro `CgfDecoder.Decrypt`: a 32-bit XOR stream. GARbro always writes whole words, so the trailing
 * partial word only affects the bytes that are still inside the buffer.
 */
function decryptCgf(data: Buffer): void {
	let key = CGF_SEED;
	for (let position = 0; position < data.length; position += 4) {
		key = rotateLeft(key, 3);
		const available = Math.min(4, data.length - position);
		for (let byte = 0; byte < available; byte += 1) {
			data[position + byte] =
				(data[position + byte] ?? 0) ^ ((key >>> (byte * 8)) & 0xff);
		}
		key = (key + CGF_SEED) >>> 0;
	}
}

/** GARbro `DafOpener.OpenEntry`: `.snr` payloads are unwrapped and inflated. */
async function decodeSnrPayload(payload: Buffer): Promise<Buffer | undefined> {
	if (
		payload.length <= SNR_HEADER_SIZE ||
		!payload.subarray(0, SNR_MARKER.length).equals(SNR_MARKER)
	)
		return undefined;
	const data = Buffer.from(payload.subarray(SNR_HEADER_SIZE));
	try {
		decryptSnr(data);
		decryptCgf(data);
		return await inflateZlibBuffer(data.subarray(SNR_ZLIB_OFFSET));
	} catch {
		return undefined;
	}
}

class DafArchiveHandle implements ArchiveHandle {
	readonly sourcePath: string;
	readonly format = dafDescriptor;
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
		const decoded = this.#decoded.get(entryId);
		if (decoded) return Readable.from([decoded]);
		return this.#source.createReadStream(entry.offset, entry.packedSize);
	}

	async close(): Promise<void> {
		await this.#source.close();
	}
}

interface DafIndex {
	entries: FixedEntry[];
	decoded: Map<string, Buffer>;
}

/**
 * GARbro `DafOpener.TryOpen`. Records start at 8 and are 0x20 bytes: the data offset, the stored
 * size, and a 0x18-byte CP932 name. GARbro unwraps `.snr` payloads on extraction, where it also
 * falls back to the raw bytes when the decoder fails.
 *
 * The port unwraps those payloads while listing the archive, because only then is the unpacked size
 * known and extraction can verify it. Decoded payloads are kept in memory for the lifetime of the
 * handle.
 */
async function readDafIndex(source: ByteSource): Promise<DafIndex | undefined> {
	if (source.size < BigInt(INDEX_OFFSET)) return undefined;
	const header = await source.readAt(0n, INDEX_OFFSET);
	if (!header.subarray(0, SIGNATURE.length).equals(SIGNATURE)) return undefined;
	const count = header.readInt32LE(COUNT_OFFSET);
	if (!isSaneCount(count)) return undefined;
	const indexSize = count * RECORD_SIZE;
	if (BigInt(INDEX_OFFSET + indexSize) > source.size) return undefined;
	const index = await source.readAt(BigInt(INDEX_OFFSET), indexSize);
	const entries: FixedEntry[] = [];
	const decoded = new Map<string, Buffer>();
	for (let id = 0; id < count; id += 1) {
		const record = id * RECORD_SIZE;
		const offset = BigInt(index.readUInt32LE(record));
		const stored = BigInt(index.readUInt32LE(record + SIZE_OFFSET));
		const name = decodeCStringField(index, record + NAME_OFFSET, NAME_SIZE);
		if (!checkPlacement(offset, stored, source.size)) return undefined;
		const entry: FixedEntry = createFixedEntry({
			id,
			...normalizeEntryPath(name),
			offset,
			size: stored,
		});
		if (sourceExtension(name) === SNR_EXTENSION && stored > 0n) {
			const payload = await source.readAt(offset, Number(stored));
			const inflated = await decodeSnrPayload(payload);
			if (inflated) {
				decoded.set(entry.id, inflated);
				entry.size = BigInt(inflated.length);
				entry.compressed = true;
				entry.metadata = { ...entry.metadata, snr: true };
			}
		}
		entries.push(entry);
	}
	return { entries, decoded };
}

export const dafFormat: ArchiveFormat = {
	descriptor: dafDescriptor,
	detection: { signatures: [{ bytes: SIGNATURE }] },
	async detect(source: ByteSource): Promise<boolean> {
		return (await readDafIndex(source)) !== undefined;
	},
	async open(source: ByteSource, sourcePath: string): Promise<ArchiveHandle> {
		const index = await readDafIndex(source);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Cadath DAF layout");
		return new DafArchiveHandle(
			source,
			sourcePath,
			index.entries,
			index.decoded,
		);
	},
};
