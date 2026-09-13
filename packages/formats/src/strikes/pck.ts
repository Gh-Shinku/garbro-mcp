// Format reference: GARbro "ArcFormats/Strikes/ArcPCK.cs", classes `PckOpener` and `RandomGenerator`.
// GARBro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import {
	GarbroError,
	decodeCp932,
	type ArchiveFormat,
	type ByteSource,
	type FormatDescriptor,
} from "@garbro-mcp/core";
import { inflateLzss } from "@garbro-mcp/codecs";
import { Readable } from "node:stream";
import {
	checkPlacement,
	createFixedEntry,
	defineFixedArchive,
	normalizeEntryPath,
	type FixedEntry,
} from "../shared/fixed-archive.js";

const TARGET_FILE_NAME = "avgdatas.pck";
const TRAILER_SIZE = 104;
const HEADER_OFFSET_FROM_END = 100;
const HEADER_SIZE = 100;
const CHECKSUM_XOR = 0xdefd32d3;
const CHECKSUM_LENGTH_FIELD = 24;
const INDEX_POSITION_FIELD = 28;
const INDEX_SKIP_SIZE = 8;
const ENTRY_NAME_SIZE = 0x28;
const CHUNK_FLAG_MASK = 0x80000000;
const CHUNK_SIZE_MASK = 0x7fffffff;
const LZSS_FRAME_SIZE = 0x1000;
const LZSS_FRAME_INIT = 0xfee;
const SHORT_PAYLOAD_SIZE = 0x10;
const LONG_PAYLOAD_KEY = 0xc53a9a6c;
const SHORT_PAYLOAD_KEY = 0x6c9a3ac5;
const MAX_SKIP_SIZE = 8;
const PRNG_MODULUS = 1000000000;

/** `RandomGenerator`: a lagged Fibonacci style generator with a decimal modulus. */
class StrikesRandomGenerator {
	readonly #state = new Int32Array(56);
	#count = 0;

	constructor(seed: number) {
		let value = 1;
		this.#state[55] = seed | 0;
		for (let i = 1; i <= 54; i += 1) {
			const position = (21 * i) % 55;
			this.#state[position] = value;
			value = (seed | 0) - value;
			if (value < 0) value += PRNG_MODULUS;
			seed = this.#state[position] ?? 0;
		}
		this.#shuffle();
		this.#shuffle();
		this.#shuffle();
		this.#count = 55;
	}

	#shuffle(): void {
		for (let i = 1; i <= 24; i += 1) {
			let next = (this.#state[i] ?? 0) - (this.#state[i + 31] ?? 0);
			if (next < 0) next += PRNG_MODULUS;
			this.#state[i] = next;
		}
		for (let i = 25; i <= 55; i += 1) {
			let next = (this.#state[i] ?? 0) - (this.#state[i - 24] ?? 0);
			if (next < 0) next += PRNG_MODULUS;
			this.#state[i] = next;
		}
	}

	rand(): number {
		this.#count += 1;
		if (this.#count > 55) {
			this.#shuffle();
			this.#count = 1;
		}
		return (this.#state[this.#count] ?? 0) >>> 0;
	}

	/** `RandomGenerator.Decrypt`: a big endian word XOR over whole dwords. */
	decrypt(data: Buffer, length: number): void {
		for (let i = 0; i < length; i += 4) {
			const key = this.rand();
			data[i] = (data[i] ?? 0) ^ ((key >>> 24) & 0xff);
			if (i + 1 < data.length)
				data[i + 1] = (data[i + 1] ?? 0) ^ ((key >>> 16) & 0xff);
			if (i + 2 < data.length)
				data[i + 2] = (data[i + 2] ?? 0) ^ ((key >>> 8) & 0xff);
			if (i + 3 < data.length) data[i + 3] = (data[i + 3] ?? 0) ^ (key & 0xff);
		}
	}
}

/** `PckOpener.DecryptData`: a repeating four byte little endian key. */
function decryptData(data: Buffer, length: number, key: number): void {
	for (let i = 0; i < length; i += 1) {
		data[i] = (data[i] ?? 0) ^ ((key >>> ((i & 3) << 3)) & 0xff);
	}
}

interface StrikesEntry {
	path: string;
	offset: bigint;
	storedSize: number;
	dataSize: number;
	skipSize: number;
	size: number;
	packed: boolean;
	encrypted: boolean;
	unpackedSize: number;
}

/**
 * `PckOpener.ReadChunk`: a chunk is a little endian header word followed by the chunk body and a
 * trailing word that belongs to the next chunk, so the body is shifted behind the header.
 */
async function readChunk(
	source: ByteSource,
	skipSize: number,
	offset: bigint,
): Promise<{ data: Buffer; chunkSize: number } | undefined> {
	const stride = BigInt(skipSize * 4);
	if (offset + stride + 4n > source.size) return undefined;
	const header = (await source.readAt(offset, 4)).readUInt32LE(0);
	const chunkSize = (await source.readAt(offset + stride, 4)).readUInt32BE(0);
	const size = chunkSize & CHUNK_SIZE_MASK;
	if (offset + 4n + BigInt(size) > source.size) return undefined;
	const chunk = Buffer.from(await source.readAt(offset + 4n, size));
	if (skipSize > 0) {
		// The body is shifted behind the little endian header word.
		chunk.copy(chunk, 4, 0, skipSize * 4 - 4);
		chunk.writeUInt32LE(header, 0);
	}
	return { data: chunk, chunkSize };
}

async function readStrikesIndex(
	source: ByteSource,
	sourcePath: string,
): Promise<StrikesEntry[] | undefined> {
	const fileName = (sourcePath.split(/[\\/]/).pop() ?? "").toLowerCase();
	if (fileName !== TARGET_FILE_NAME) return undefined;
	if (source.size < BigInt(TRAILER_SIZE)) return undefined;
	const seedBytes = await source.readAt(source.size - BigInt(TRAILER_SIZE), 4);
	const seed = seedBytes.readInt32BE(0);
	const header = Buffer.from(
		await source.readAt(
			source.size - BigInt(HEADER_OFFSET_FROM_END),
			HEADER_SIZE,
		),
	);
	const generator = new StrikesRandomGenerator(seed);
	generator.decrypt(header, header.length);
	const checksum =
		(((header[1] ?? 0) |
			((header[2] ?? 0) << 8) |
			((header[0] ?? 0) << 16) |
			((header[3] ?? 0) << 24)) ^
			CHECKSUM_XOR) >>>
		0;
	const length = header.readUInt32BE(CHECKSUM_LENGTH_FIELD);
	if (checksum !== length) return undefined;
	const indexPosition = header.readUInt32BE(INDEX_POSITION_FIELD);
	const chunk = await readChunk(
		source,
		INDEX_SKIP_SIZE,
		BigInt(indexPosition + 4),
	);
	if (!chunk) return undefined;
	let index = chunk.data;
	if ((chunk.chunkSize & CHUNK_FLAG_MASK) !== 0) {
		const unpackedSize = chunk.chunkSize & CHUNK_SIZE_MASK;
		index = inflateLzss(index, {
			frameSize: LZSS_FRAME_SIZE,
			frameInitPosition: LZSS_FRAME_INIT,
			outputLength: unpackedSize,
		});
	}
	const entries: StrikesEntry[] = [];
	let position = 0;
	let directoryIndex = 0;
	while (position < index.length) {
		if (position + 16 > index.length) return undefined;
		const count = index.readInt32BE(position + 12);
		position += 16;
		if (count < 0 || count > 0x40000) return undefined;
		const prefix = directoryIndex.toString(16).toUpperCase().padStart(4, "0");
		for (let i = 0; i < count; i += 1) {
			if (position + ENTRY_NAME_SIZE + 16 > index.length) return undefined;
			const field = index.subarray(position, position + ENTRY_NAME_SIZE);
			const terminator = field.indexOf(0);
			const name = decodeName(
				terminator === -1 ? field : field.subarray(0, terminator),
			);
			position += ENTRY_NAME_SIZE;
			const offset = BigInt(index.readUInt32BE(position));
			const storedSize = index.readUInt32BE(position + 4);
			const encrypted = index.readInt32LE(position + 8) !== 0;
			const unpackedSize = index.readUInt32LE(position + 12);
			position += 16;
			if (!checkPlacement(offset, BigInt(storedSize), source.size))
				return undefined;
			const { dataSize, skipSize } = await findChunkStart(
				source,
				offset,
				storedSize,
			);
			entries.push({
				path: `${prefix}/${name}`,
				offset,
				storedSize,
				dataSize,
				skipSize,
				size: storedSize === unpackedSize ? dataSize : unpackedSize,
				packed: storedSize !== unpackedSize,
				encrypted,
				unpackedSize,
			});
		}
		directoryIndex += 1;
	}
	return entries.length === 0 ? undefined : entries;
}

function decodeName(bytes: Buffer): string {
	return decodeCp932(bytes);
}

/** `PckOpener.OpenEntry` step one: find the chunk header whose size matches the record. */
async function findChunkStart(
	source: ByteSource,
	offset: bigint,
	storedSize: number,
): Promise<{ dataSize: number; skipSize: number }> {
	for (let skipSize = MAX_SKIP_SIZE; skipSize > 0; skipSize -= 1) {
		const probeOffset = offset + BigInt(skipSize * 4);
		if (probeOffset + 4n > source.size) continue;
		const probe = (await source.readAt(probeOffset, 4)).readUInt32BE(0);
		if (probe + 4 === storedSize) return { dataSize: storedSize - 4, skipSize };
	}
	return { dataSize: storedSize, skipSize: 0 };
}

export const strikesPckDescriptor: FormatDescriptor = {
	id: "strikes-pck",
	name: "Strikes resource archive",
	extensions: ["pck"],
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
			source: "ArcFormats/Strikes/ArcPCK.cs",
			license: "MIT",
			commit: "b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0",
		},
	],
};

export const strikesPckFormat: ArchiveFormat = defineFixedArchive({
	descriptor: strikesPckDescriptor,
	detection: { signatures: [] },
	async detect(source: ByteSource, sourcePath: string): Promise<boolean> {
		return (await readStrikesIndex(source, sourcePath)) !== undefined;
	},
	async read(source: ByteSource, sourcePath: string) {
		const index = await readStrikesIndex(source, sourcePath);
		if (!index)
			throw new GarbroError("INVALID_ARCHIVE", "Invalid Strikes index");
		const entries: FixedEntry[] = index.map((entry, id) => {
			const created = createFixedEntry({
				id,
				...normalizeEntryPath(entry.path),
				offset: entry.offset,
				size: BigInt(entry.size),
				packedSize: BigInt(entry.dataSize),
				compressed: entry.packed,
				encrypted: entry.encrypted,
				metadata: {
					unpackedSize: entry.unpackedSize,
					storedSize: entry.storedSize,
					skipSize: entry.skipSize,
				},
			});
			return entry.packed ? { ...created, sizeKnown: false } : created;
		});
		return {
			entries,
			metadata: { entryCount: entries.length },
		};
	},
	async openEntry(source: ByteSource, entry: FixedEntry) {
		const metadata = entry.metadata as
			| { unpackedSize?: number; storedSize?: number; skipSize?: number }
			| undefined;
		const storedSize = metadata?.storedSize ?? Number(entry.packedSize);
		const skipSize = metadata?.skipSize ?? 0;
		let data: Buffer;
		if (skipSize === 0) {
			data = Buffer.from(await source.readAt(entry.offset, storedSize));
		} else {
			const chunk = await readChunk(source, skipSize, entry.offset);
			if (!chunk)
				throw new GarbroError("INVALID_ARCHIVE", "Invalid Strikes chunk");
			data = chunk.data;
		}
		if (entry.encrypted) {
			if (data.length >= SHORT_PAYLOAD_SIZE)
				decryptData(data, 0x10, LONG_PAYLOAD_KEY);
			else decryptData(data, data.length, SHORT_PAYLOAD_KEY);
		}
		if (!entry.compressed) return Readable.from([data]);
		return Readable.from([
			inflateLzss(data, {
				frameSize: LZSS_FRAME_SIZE,
				frameInitPosition: LZSS_FRAME_INIT,
				outputLength: metadata?.unpackedSize ?? 0,
			}),
		]);
	},
});
