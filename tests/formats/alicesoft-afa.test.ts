import { BufferByteSource } from "@garbro-mcp/core";
import { deflateSync } from "node:zlib";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { alicesoftAfaFormat } from "../../packages/formats/src/alicesoft/afa.js";

const INDEX_OFFSET = 0x2c;
const AFF_KEY = Buffer.from([
	0xc8, 0xbb, 0x8f, 0xb7, 0xed, 0x43, 0x99, 0x4a, 0xa2, 0x7e, 0x5b, 0xb0, 0x68,
	0x18, 0xf8, 0x88,
]);

interface AfaEntry {
	name: string;
	offset: number;
	size: number;
}

/** Builds the index records: name length, step, name, skipped words, offset and size. */
function buildIndex(entries: AfaEntry[], version: number): Buffer {
	const parts: Buffer[] = [];
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "latin1");
		const head = Buffer.alloc(8);
		head.writeInt32LE(name.length, 0);
		head.writeInt32LE(name.length, 4);
		const tail = Buffer.alloc(version < 2 ? 20 : 16);
		tail.writeUInt32LE(entry.offset, version < 2 ? 12 : 8);
		tail.writeUInt32LE(entry.size, version < 2 ? 16 : 12);
		parts.push(Buffer.concat([head, name, tail]));
	}
	return Buffer.concat(parts);
}

/**
 * Builds an `AFF` payload: a sixteen byte header and a body whose first forty bytes, or all of it
 * when it is shorter, are masked with the repeating key.
 */
function buildAff(plain: Buffer): Buffer {
	const header = Buffer.alloc(0x10);
	header.write("AFF\0", 0, "latin1");
	const masked = Buffer.from(plain);
	const count = Math.min(0x40, masked.length);
	for (let index = 0; index < count; index += 1)
		masked[index] =
			(masked[index] ?? 0) ^ (AFF_KEY[index % AFF_KEY.length] ?? 0);
	return Buffer.concat([header, masked]);
}

/**
 * Builds an AliceSoft AFA archive: the fixed header, the zlib compressed index and the payloads at
 * the offsets the index records.
 */
function buildAfa(
	entries: { name: string; data: Buffer }[],
	options: {
		version?: number;
		base?: number;
		count?: number;
		info?: string;
	} = {},
): Buffer {
	const base = options.base ?? 0;
	const version = options.version ?? 2;
	let position = INDEX_OFFSET + 0x100;
	const records: AfaEntry[] = [];
	const payloads: { offset: number; data: Buffer }[] = [];
	for (const entry of entries) {
		records.push({
			name: entry.name,
			offset: position - base,
			size: entry.data.length,
		});
		payloads.push({ offset: position, data: entry.data });
		position += entry.data.length;
	}
	const index = buildIndex(records, version);
	const packed = deflateSync(index);
	const head = Buffer.alloc(INDEX_OFFSET);
	head.write("AFAH", 0, "latin1");
	head.write("AlicArch", 8, "latin1");
	head.writeInt32LE(version, 0x10);
	head.writeUInt32LE(base, 0x18);
	head.write(options.info ?? "INFO", 0x1c, "latin1");
	head.writeUInt32LE(packed.length, 0x20);
	head.writeInt32LE(index.length, 0x24);
	head.writeInt32LE(options.count ?? entries.length, 0x28);
	const length = Math.max(
		INDEX_OFFSET + packed.length,
		...payloads.map((payload) => payload.offset + payload.data.length),
	);
	const file = Buffer.alloc(length);
	head.copy(file, 0);
	packed.copy(file, INDEX_OFFSET);
	for (const payload of payloads) payload.data.copy(file, payload.offset);
	return file;
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("alicesoft afa", () => {
	it("lists entries and extracts them", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload bytes");
		const file = buildAfa([
			{ name: "DATA\\FILE.BIN", data: first },
			{ name: "FILE2.BIN", data: second },
		]);
		const source = sourceOf(file);
		expect(await alicesoftAfaFormat.detect(source)).toBe(true);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"DATA/FILE.BIN",
				"FILE2.BIN",
			]);
			expect(archive.entries[0]?.rawPath).toBe("DATA\\FILE.BIN");
			expect(archive.entries.map((entry) => Number(entry.size))).toEqual([
				first.length,
				second.length,
			]);
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});

	it("unmasks the aff prefix of an entry", async () => {
		// Only the first forty bytes of the payload are masked, the rest is stored plain.
		const plain = Buffer.concat([
			Buffer.from("first part of the payload"),
			Buffer.alloc(0x40),
		]);
		const file = buildAfa([{ name: "IMAGE.QNT", data: buildAff(plain) }]);
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.encrypted).toBe(true);
			expect(entry.metadata).toMatchObject({ affPrefix: 0x40 });
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(output.length).toBe(0x10 + plain.length);
			expect(output.subarray(0, 4).toString("latin1")).toBe("AFF\0");
			expect(output.subarray(0x10)).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("keeps a short aff payload intact apart from the prefix", async () => {
		const plain = Buffer.from("short payload");
		const file = buildAfa([{ name: "SMALL.AJP", data: buildAff(plain) }]);
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ affPrefix: plain.length });
			const output = await consumeBuffer(await archive.openEntry(entry.id));
			expect(Number(entry.size)).toBe(output.length);
			expect(output.subarray(0x10)).toEqual(plain);
		} finally {
			await archive.close();
		}
	});

	it("reads the older record layout", async () => {
		const data = Buffer.from("version one payload");
		const file = buildAfa([{ name: "OLD.BIN", data }], { version: 1 });
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "old.afa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("applies the base offset from the header", async () => {
		const data = Buffer.from("shifted payload");
		const file = buildAfa([{ name: "SHIFT.BIN", data }], { base: 0x20 });
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "game.afa");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file without the info marker", async () => {
		const file = buildAfa([{ name: "A.BIN", data: Buffer.from("x") }], {
			info: "NOPE",
		});
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an insane entry count", async () => {
		const file = buildAfa([{ name: "A.BIN", data: Buffer.from("x") }], {
			count: 0x100000,
		});
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines an entry that does not fit in the file", async () => {
		const file = buildAfa([{ name: "A.BIN", data: Buffer.from("payload") }]);
		const index = deflateSync(
			buildIndex([{ name: "A.BIN", offset: 0x2000, size: 0x100 }], 2),
		);
		index.copy(file, INDEX_OFFSET);
		file.writeUInt32LE(index.length, 0x20);
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});
});

/** Mirror of `AfaIndexReader.RandomGenerator`, the generator the bit stream pads itself with. */
class AfaRandomMirror {
	static readonly SIZE = 521;
	readonly state = new Uint32Array(AfaRandomMirror.SIZE);
	current = -1;

	constructor(seed: number) {
		let value = 0;
		let state = seed >>> 0;
		for (let i = 0; i < 17; i += 1) {
			for (let j = 0; j < 32; j += 1) {
				state = (Math.imul(1566083941, state) + 1) >>> 0;
				value = ((state & 0x80000000) | (value >>> 1)) >>> 0;
			}
			this.state[i] = value;
		}
		this.state[16] =
			((this.state[15] ?? 0) ^
				((this.state[0] ?? 0) >>> 9) ^
				((this.state[16] ?? 0) << 23)) >>>
			0;
		for (let i = 17; i < AfaRandomMirror.SIZE; i += 1) {
			this.state[i] =
				((this.state[i - 1] ?? 0) ^
					((this.state[i - 16] ?? 0) >>> 9) ^
					((this.state[i - 17] ?? 0) << 23)) >>>
				0;
		}
		for (let pass = 0; pass < 4; pass += 1) this.shuffle();
	}

	getNext(): number {
		this.current += 1;
		if (this.current >= AfaRandomMirror.SIZE) {
			this.shuffle();
			this.current = 0;
		}
		return this.state[this.current] ?? 0;
	}

	shuffle(): void {
		for (let i = 0; i < 32; i += 4) {
			for (let j = 0; j < 4; j += 1)
				this.state[i + j] =
					((this.state[i + j] ?? 0) ^ (this.state[i + 489 + j] ?? 0)) >>> 0;
		}
		for (let i = 32; i < AfaRandomMirror.SIZE; i += 3) {
			for (let j = 0; j < 3; j += 1)
				this.state[i + j] =
					((this.state[i + j] ?? 0) ^ (this.state[i - 32 + j] ?? 0)) >>> 0;
		}
	}
}

/** Most significant bit first bit writer, the ordering `MsbBitStream` reads. */
class BitWriter {
	readonly #bytes: number[] = [];
	#current = 0;
	#count = 0;

	writeBits(value: number, count: number): void {
		for (let index = count - 1; index >= 0; index -= 1)
			this.#push((value >>> index) & 1);
	}

	#push(bit: number): void {
		this.#current = (this.#current << 1) | bit;
		this.#count += 1;
		if (this.#count === 8) {
			this.#bytes.push(this.#current);
			this.#current = 0;
			this.#count = 0;
		}
	}

	toBuffer(): Buffer {
		const output = Buffer.from(this.#bytes);
		if (this.#count === 0) return output;
		return Buffer.concat([
			output,
			Buffer.from([this.#current << (8 - this.#count)]),
		]);
	}
}

function writeV3Int32(writer: BitWriter, value: number): void {
	for (let index = 0; index < 4; index += 1)
		writer.writeBits((value >>> (8 * index)) & 0xff, 8);
}

/** Writes a size prefixed element list with the generator driven padding bits. */
function writeV3Scattered(
	writer: BitWriter,
	values: number[],
	wide: boolean,
): void {
	writeV3Int32(writer, values.length);
	const random = new AfaRandomMirror(values.length);
	for (const value of values) {
		const count = random.getNext() & 3;
		writer.writeBits(0, count + 1);
		random.getNext();
		writer.writeBits(value & 0xff, 8);
		if (wide) writer.writeBits((value >>> 8) & 0xff, 8);
	}
}

/**
 * Builds a version three archive: an identity dictionary, then a zlib compressed listing whose entry
 * offsets are relative to the end of the packed index stream.
 */
function buildV3(
	entries: { name: Buffer; data: Buffer }[],
	options: { count?: number } = {},
): Buffer {
	const dictionary = Array.from({ length: 0x100 }, (_, index) => index);
	let stage1: Buffer = Buffer.alloc(0);
	let records: { offset: number; size: number }[] = [];
	let packed: Buffer = Buffer.alloc(0);
	for (let pass = 0; pass < 8; pass += 1) {
		const dataOffset = 12 + stage1.length;
		let position = dataOffset;
		records = entries.map((entry) => {
			const offset = position;
			position += entry.data.length;
			return { offset, size: entry.data.length };
		});
		const listing = new BitWriter();
		listing.writeBits(0, 1);
		const count = options.count ?? entries.length;
		writeV3Int32(listing, count);
		for (let index = 0; index < count; index += 1) {
			const entry = entries[index];
			listing.writeBits(0, 2);
			if (!entry) continue;
			const chars = [...entry.name].map((byte) => byte ^ 0xa4);
			writeV3Scattered(listing, chars, true);
			writeV3Int32(listing, 0);
			writeV3Int32(listing, 0);
			writeV3Int32(listing, (records[index]?.offset ?? 0) - dataOffset);
			writeV3Int32(listing, records[index]?.size ?? 0);
		}
		const listingBytes = listing.toBuffer();
		packed = deflateSync(listingBytes);
		const next = new BitWriter();
		next.writeBits(0, 1);
		writeV3Scattered(next, dictionary, false);
		writeV3Int32(next, packed.length);
		writeV3Int32(next, listingBytes.length);
		for (const byte of packed) next.writeBits(byte, 8);
		const candidate = next.toBuffer();
		const stable = candidate.length === stage1.length;
		stage1 = candidate;
		if (stable) break;
	}
	// Recompute the layout with the final index stream length.
	const dataOffset = 12 + stage1.length;
	let position = dataOffset;
	records = entries.map((entry) => {
		const offset = position;
		position += entry.data.length;
		return { offset, size: entry.data.length };
	});
	const file = Buffer.alloc(position);
	file.write("AFAH", 0, "latin1");
	file.writeUInt32LE(4 + stage1.length, 4);
	file.writeInt32LE(3, 8);
	stage1.copy(file, 12);
	entries.forEach((entry, index) => {
		entry.data.copy(file, records[index]?.offset ?? 0);
	});
	return file;
}

describe("alicesoft afa version three", () => {
	it("lists and extracts entries of the packed index", async () => {
		const first = Buffer.from("version three payload");
		const keyedPlain = Buffer.from("keyed body of the second entry");
		const second = buildAff(keyedPlain);
		const file = buildV3([
			{ name: Buffer.from("FIRST.BIN", "latin1"), data: first },
			{ name: Buffer.from("SECOND.QNT", "latin1"), data: second },
		]);
		const source = sourceOf(file);
		expect(await alicesoftAfaFormat.detect(source)).toBe(true);
		const archive = await alicesoftAfaFormat.open(source, "v3.afa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"FIRST.BIN",
				"SECOND.QNT",
			]);
			expect(archive.entries[0]?.encrypted).toBe(false);
			expect(archive.entries[1]?.encrypted).toBe(true);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				first,
			);
			const keyed = archive.entries[1];
			if (!keyed) throw new Error("missing entry");
			const output = await consumeBuffer(await archive.openEntry(keyed.id));
			expect(output.subarray(0x10)).toEqual(keyedPlain);
		} finally {
			await archive.close();
		}
	});

	it("decodes names through the dictionary as cp932", async () => {
		const data = Buffer.from("japanese name payload");
		const file = buildV3([
			// The two bytes of a cp932 kana character, each stored as a dictionary index.
			{ name: Buffer.from([0x82, 0xa0]), data },
		]);
		const source = sourceOf(file);
		const archive = await alicesoftAfaFormat.open(source, "v3.afa");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["\u3042"]);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("declines a file whose version is neither layout", async () => {
		const file = buildV3([
			{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") },
		]);
		file.writeInt32LE(4, 8);
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});

	it("declines a packed index with an insane count", async () => {
		const file = buildV3(
			[{ name: Buffer.from("A.BIN", "latin1"), data: Buffer.from("x") }],
			{ count: 0x100000 },
		);
		expect(await alicesoftAfaFormat.detect(sourceOf(file))).toBe(false);
	});
});
