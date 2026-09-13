import { BufferByteSource } from "@garbro-mcp/core";
import { strikesPckFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { literalLzssStream } from "../helpers/lzss.js";

const TARGET_NAME = "AVGDatas.pck";
const HEADER_SIZE = 100;
const TRAILER_SIZE = 104;
const CHECKSUM_XOR = 0xdefd32d3;
const INDEX_SKIP_SIZE = 8;
const ENTRY_SKIP_SIZE = 1;
const INDEX_POSITION = 0x40;
const CHUNK_HEADER = 0x12345678;
const PRNG_MODULUS = 1000000000;
const PACKED_CHUNK_FLAG = 0x80000000;
const LONG_PAYLOAD_KEY = 0xc53a9a6c;
const SHORT_PAYLOAD_KEY = 0x6c9a3ac5;
const MATCH_OUTPUT = 144;

/** Mirrors the reference `RandomGenerator` so fixtures can obfuscate the trailing header. */
class FixtureGenerator {
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

	/** The obfuscation is its own inverse. */
	apply(data: Buffer, length: number): void {
		for (let i = 0; i < length; i += 4) {
			const key = this.rand();
			for (let offset = 0; offset < 4; offset += 1) {
				const target = i + offset;
				if (target >= data.length) break;
				data[target] =
					(data[target] ?? 0) ^ ((key >>> ((3 - offset) * 8)) & 0xff);
			}
		}
	}
}

/** `DecryptData`: an XOR with a repeating little endian key. */
function xorKey(data: Buffer, length: number, key: number): void {
	for (let i = 0; i < length; i += 1)
		data[i] = (data[i] ?? 0) ^ ((key >>> ((i & 3) << 3)) & 0xff);
}

function leWord(value: number): Buffer {
	const word = Buffer.alloc(4);
	word.writeUInt32LE(value, 0);
	return word;
}

/**
 * Lays out a chunk region. The opener copies the first `skip * 4 - 4` payload bytes behind a little
 * endian header word, so the payload is stored with a gap holding the big endian chunk size.
 */
function buildChunkRegion(
	payload: Buffer,
	skipSize: number,
	head: Buffer,
	declared?: number,
): Buffer {
	const gap = skipSize * 4 - 4;
	const word = Buffer.alloc(4);
	word.writeUInt32BE((declared ?? payload.length + 4) >>> 0, 0);
	return Buffer.concat([
		head,
		payload.subarray(0, gap),
		word,
		payload.subarray(gap),
	]);
}

interface EntrySpec {
	name: string;
	/** Recovered chunk payload, behind the four byte header word. */
	body: Buffer;
	/** Header word bytes; defaults to the little endian marker. */
	head?: Buffer;
	unpackedSize?: number;
	encrypted?: boolean;
	/** Declared chunk size; defaults to the recovered payload size plus four. */
	declared?: number;
}

interface ArchiveSpec {
	dirs: readonly (readonly EntrySpec[])[];
	packedIndex?: boolean;
	seed?: number;
	sizeOverride?: number;
	offsetOverride?: number;
}

/** Encodes `data` as literal groups, then pads the output with zero matches up to `outputLength`. */
function packedIndexStream(data: Uint8Array, outputLength: number): Buffer {
	const chunks: Buffer[] = [];
	let offset = 0;
	while (offset < data.length) {
		const run = data.subarray(offset, Math.min(offset + 8, data.length));
		let control = 0;
		for (let bit = 0; bit < run.length; bit += 1) control |= 1 << bit;
		chunks.push(Buffer.from([control]), Buffer.from(run));
		offset += run.length;
	}
	// Each control byte carries eight matches of eighteen zero bytes from the untouched frame area.
	let remaining = outputLength - data.length;
	while (remaining > 0) {
		chunks.push(Buffer.from([0x00]));
		for (let i = 0; i < 8; i += 1) chunks.push(Buffer.from([0x00, 0x8f]));
		remaining -= MATCH_OUTPUT;
	}
	return Buffer.concat(chunks);
}

/** Builds an `AVGDatas.pck` fixture. */
function buildArchive(spec: ArchiveSpec): Buffer {
	const seed = spec.seed ?? 0x12345678;
	const entries = spec.dirs.flat();
	// The opener parses the recovered chunk, so the chunk starts with the header word and every
	// directory block contributes twelve skipped bytes, a count and its records.
	let chunkLength = 0;
	for (const dir of spec.dirs) chunkLength += 16 + dir.length * (0x28 + 16);
	const chunk = Buffer.alloc(chunkLength);
	leWord(CHUNK_HEADER).copy(chunk, 0);
	let chunkPosition = 0;
	for (const dir of spec.dirs) {
		chunk.writeInt32BE(dir.length, chunkPosition + 12);
		chunkPosition += 16;
		for (const entry of dir) {
			const name = Buffer.alloc(0x28);
			name.write(entry.name, 0, "latin1");
			name.copy(chunk, chunkPosition);
			chunkPosition += 0x28 + 16;
		}
	}
	const regions = entries.map((entry) =>
		buildChunkRegion(
			entry.body,
			ENTRY_SKIP_SIZE,
			entry.head ?? leWord(CHUNK_HEADER),
			entry.declared,
		),
	);
	const unpackedIndexSize = spec.packedIndex
		? chunkLength + MATCH_OUTPUT
		: chunkLength;
	const provisionalStream = spec.packedIndex
		? packedIndexStream(chunk, unpackedIndexSize)
		: Buffer.alloc(0);
	const provisionalPayload = spec.packedIndex
		? provisionalStream.subarray(4)
		: chunk.subarray(4);
	const provisionalRegion = buildChunkRegion(
		Buffer.concat([
			provisionalPayload,
			Buffer.alloc(
				Math.max(0, unpackedIndexSize - 4 - provisionalPayload.length),
			),
		]),
		INDEX_SKIP_SIZE,
		spec.packedIndex ? provisionalStream.subarray(0, 4) : leWord(CHUNK_HEADER),
		spec.packedIndex ? PACKED_CHUNK_FLAG | unpackedIndexSize : chunkLength,
	);
	const entryBase = INDEX_POSITION + 4 + provisionalRegion.length;
	let cursor = entryBase;
	const offsets: number[] = [];
	for (const region of regions) {
		offsets.push(cursor);
		cursor += region.length;
	}
	chunkPosition = 0;
	let index = 0;
	for (const dir of spec.dirs) {
		chunkPosition += 16;
		for (const entry of dir) {
			const size = entry.body.length + 8;
			chunk.writeUInt32BE(
				spec.offsetOverride ?? offsets[index] ?? 0,
				chunkPosition + 0x28,
			);
			chunk.writeUInt32BE(spec.sizeOverride ?? size, chunkPosition + 0x2c);
			chunk.writeInt32LE(entry.encrypted ? 1 : 0, chunkPosition + 0x30);
			chunk.writeUInt32LE(entry.unpackedSize ?? size, chunkPosition + 0x34);
			chunkPosition += 0x28 + 16;
			index += 1;
		}
	}
	// A packed index decodes the whole recovered chunk, header word included, so the compressed
	// stream starts with the four bytes the reader treats as the chunk header.
	const packedStream = spec.packedIndex
		? packedIndexStream(chunk, unpackedIndexSize)
		: Buffer.alloc(0);
	const indexPayload = spec.packedIndex
		? packedStream.subarray(4)
		: chunk.subarray(4);
	const indexRegion = buildChunkRegion(
		Buffer.concat([
			indexPayload,
			Buffer.alloc(Math.max(0, unpackedIndexSize - 4 - indexPayload.length)),
		]),
		INDEX_SKIP_SIZE,
		spec.packedIndex ? packedStream.subarray(0, 4) : leWord(CHUNK_HEADER),
		spec.packedIndex ? PACKED_CHUNK_FLAG | unpackedIndexSize : chunkLength,
	);
	const headerPlain = Buffer.alloc(HEADER_SIZE);
	const checksum =
		(((headerPlain[1] ?? 0) |
			((headerPlain[2] ?? 0) << 8) |
			((headerPlain[0] ?? 0) << 16) |
			((headerPlain[3] ?? 0) << 24)) ^
			CHECKSUM_XOR) >>>
		0;
	headerPlain.writeUInt32BE(checksum, 24);
	headerPlain.writeUInt32BE(INDEX_POSITION, 28);
	const header = Buffer.from(headerPlain);
	new FixtureGenerator(seed).apply(header, header.length);
	const seedWord = Buffer.alloc(4);
	seedWord.writeInt32BE(seed, 0);
	return Buffer.concat([
		Buffer.alloc(INDEX_POSITION + 4),
		indexRegion,
		...regions,
		seedWord,
		header,
	]);
}

async function openArchive(file: Buffer) {
	const source = new BufferByteSource(file);
	const archive = await strikesPckFormat.open(source, TARGET_NAME);
	return archive;
}

async function readEntry(
	archive: Awaited<ReturnType<typeof openArchive>>,
	id: string,
): Promise<Buffer> {
	const parts: Buffer[] = [];
	for await (const chunk of await archive.openEntry(id))
		parts.push(Buffer.from(chunk as Uint8Array));
	return Buffer.concat(parts);
}

describe("Strikes resource archive", () => {
	it("reads a stored entry", async () => {
		const body = Buffer.from("plain strikes body");
		const file = buildArchive({ dirs: [[{ name: "A.DAT", body }]] });
		expect(
			await strikesPckFormat.detect(new BufferByteSource(file), TARGET_NAME),
		).toBe(true);
		const archive = await openArchive(file);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect({ path: entry.path, size: entry.size }).toEqual({
				path: "0000/A.DAT",
				size: BigInt(body.length + 4),
			});
			expect(await readEntry(archive, entry.id)).toEqual(
				Buffer.concat([leWord(CHUNK_HEADER), body]),
			);
		} finally {
			await archive.close();
		}
	});

	it("numbers records by directory", async () => {
		const file = buildArchive({
			dirs: [
				[{ name: "ONE.DAT", body: Buffer.from("first") }],
				[{ name: "TWO.DAT", body: Buffer.from("second") }],
			],
		});
		const archive = await openArchive(file);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"0000/ONE.DAT",
				"0001/TWO.DAT",
			]);
		} finally {
			await archive.close();
		}
	});

	it("unpacks a compressed entry", async () => {
		const unpacked = Buffer.from("compressed strikes payload");
		// The compressed stream starts with the chunk header word the reader prepends.
		const stream = literalLzssStream(unpacked);
		const file = buildArchive({
			dirs: [
				[
					{
						name: "C.DAT",
						body: stream.subarray(4),
						head: stream.subarray(0, 4),
						unpackedSize: unpacked.length,
					},
				],
			],
		});
		const archive = await openArchive(file);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry).toMatchObject({
				compressed: true,
				size: BigInt(unpacked.length),
				sizeKnown: false,
			});
			expect(await readEntry(archive, entry.id)).toEqual(unpacked);
		} finally {
			await archive.close();
		}
	});

	it("decrypts a long entry", async () => {
		const head = leWord(CHUNK_HEADER);
		const body = Buffer.alloc(0x40, 0x5a);
		const plain = Buffer.concat([head, body]);
		const encrypted = Buffer.from(plain);
		xorKey(encrypted, 0x10, LONG_PAYLOAD_KEY);
		const file = buildArchive({
			dirs: [
				[
					{
						name: "E.DAT",
						body: encrypted.subarray(4),
						head: encrypted.subarray(0, 4),
						encrypted: true,
					},
				],
			],
		});
		const archive = await openArchive(file);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(await readEntry(archive, entry.id)).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("decrypts a short entry with the other key", async () => {
		const head = leWord(CHUNK_HEADER);
		const body = Buffer.from([1, 2, 3, 4]);
		const plain = Buffer.concat([head, body]);
		const encrypted = Buffer.from(plain);
		xorKey(encrypted, encrypted.length, SHORT_PAYLOAD_KEY);
		const file = buildArchive({
			dirs: [
				[
					{
						name: "S.DAT",
						body: encrypted.subarray(4),
						head: encrypted.subarray(0, 4),
						encrypted: true,
					},
				],
			],
		});
		const archive = await openArchive(file);
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await readEntry(archive, entry.id)).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("reads a compressed index", async () => {
		const body = Buffer.from("packed index payload");
		const file = buildArchive({
			dirs: [[{ name: "P.DAT", body }]],
			packedIndex: true,
		});
		expect(
			await strikesPckFormat.detect(new BufferByteSource(file), TARGET_NAME),
		).toBe(true);
		const archive = await openArchive(file);
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"0000/P.DAT",
			]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await readEntry(archive, entry.id)).toEqual(
				Buffer.concat([leWord(CHUNK_HEADER), body]),
			);
		} finally {
			await archive.close();
		}
	});

	it("rejects another file name", async () => {
		const file = buildArchive({
			dirs: [[{ name: "A.DAT", body: Buffer.from("data") }]],
		});
		expect(
			await strikesPckFormat.detect(new BufferByteSource(file), "other.pck"),
		).toBe(false);
	});

	it("rejects a broken checksum", async () => {
		const file = buildArchive({
			dirs: [[{ name: "A.DAT", body: Buffer.from("data") }]],
		});
		file.writeInt32BE(0x11111111, file.length - TRAILER_SIZE);
		expect(
			await strikesPckFormat.detect(new BufferByteSource(file), TARGET_NAME),
		).toBe(false);
	});

	it("rejects a truncated trailer", async () => {
		const file = buildArchive({
			dirs: [[{ name: "A.DAT", body: Buffer.from("data") }]],
		});
		expect(
			await strikesPckFormat.detect(
				new BufferByteSource(file.subarray(0, 32)),
				TARGET_NAME,
			),
		).toBe(false);
	});

	it("rejects an entry outside the file", async () => {
		const file = buildArchive({
			dirs: [[{ name: "A.DAT", body: Buffer.from("data") }]],
			sizeOverride: 0x100000,
		});
		expect(
			await strikesPckFormat.detect(new BufferByteSource(file), TARGET_NAME),
		).toBe(false);
	});

	it("rejects an offset past the end of file", async () => {
		const file = buildArchive({
			dirs: [[{ name: "A.DAT", body: Buffer.from("data") }]],
			offsetOverride: 0x100000,
		});
		expect(
			await strikesPckFormat.detect(new BufferByteSource(file), TARGET_NAME),
		).toBe(false);
	});
});
