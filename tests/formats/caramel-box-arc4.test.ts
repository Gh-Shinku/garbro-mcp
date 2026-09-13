import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { caramelBoxArc4Format } from "../../packages/formats/src/caramel-box/arc4.js";

const HEADER_SIZE = 0x30;
const SEGMENT_HEADER_SIZE = 0x10;
const KEY_FACTOR = 0x1465d9;
const KEY_ADDEND = 0x0fb5;
const UINT32 = 0x100000000;

/** Applies the inverse of the running key the reader subtracts from every word. */
function encryptBlock(data: Buffer, initialKey: number): Buffer {
	const padded = Buffer.alloc(data.length + (data.length % 2));
	data.copy(padded);
	let key = initialKey >>> 0;
	for (let position = 0; position + 2 <= padded.length; position += 2) {
		key = (key * KEY_FACTOR + KEY_ADDEND) % UINT32;
		const word = padded.readUInt16LE(position);
		padded.writeUInt16LE((word + (key >>> 16)) & 0xffff, position);
	}
	return padded;
}

/** Wraps a block in a TzCompression stream: `tZ`, the unpacked size, one block header, the block. */
function tzBlock(
	marker: number,
	body: Buffer,
	unpackedSize: number,
	key: number,
): Buffer {
	const encrypted = encryptBlock(body, key);
	const header = Buffer.alloc(6);
	header.write("tZ", 0, "latin1");
	header.writeUInt32LE(unpackedSize, 2);
	const block = Buffer.alloc(8);
	block.writeUInt16LE(marker, 0);
	block.writeUInt16LE(encrypted.length, 2);
	block.writeUInt16LE(unpackedSize, 4);
	block.writeUInt16LE(key, 6);
	return Buffer.concat([header, block, encrypted]);
}

/** A stream whose single block is stored verbatim. */
function tzStored(plain: Buffer, key = 0x1234): Buffer {
	return tzBlock(0x7453, plain, plain.length, key); // 'St'
}

/** A stream whose single block writes every byte as a literal. */
function tzPackedLiterals(plain: Buffer, key = 0x4321): Buffer {
	const body: number[] = [];
	for (let position = 0; position < plain.length; position += 0x7f) {
		const run = plain.subarray(position, position + 0x7f);
		body.push(run.length, ...run);
	}
	body.push(0);
	return tzBlock(0x745a, Buffer.from(body), plain.length, key); // 'Zt'
}

/** A stream whose block emits literals and then one short back reference. */
function tzPackedMatch(
	literals: Buffer,
	offset: number,
	count: number,
	key = 0x7777,
): Buffer {
	const body = Buffer.from([
		literals.length,
		...literals,
		0x80 | ((offset - 1) << 2) | (count - 2),
		0,
	]);
	return tzBlock(0x745a, body, literals.length + count, key);
}

interface Arc4FixtureEntry {
	name: string;
	/** Plain payload of the entry. */
	data: Buffer;
	/** Wraps the payload in a TzCompression stream. */
	packed?: "stored" | "literals" | "match";
	/** Splits the stored payload into this many segments. */
	segments?: number;
}

/** Builds the TZ stream an entry stores, then splits it into the requested segment count. */
function entryStream(entry: Arc4FixtureEntry, entryIndex: number): Buffer {
	const plain = entry.data;
	if (entry.packed === "literals")
		return tzPackedLiterals(plain, 0x100 + entryIndex);
	if (entry.packed === "match")
		return tzPackedMatch(plain.subarray(0, 4), 4, 3, 0x200 + entryIndex);
	if (entry.packed === "stored") return tzStored(plain, 0x300 + entryIndex);
	return plain;
}

/**
 * Builds a Caramel BOX ARC4 archive: a header, a stored TzCompression index, and one segment header
 * per stored payload. Alignment is one and the base offset is zero, so segment addresses are plain
 * file offsets.
 */
function buildArc4(entries: Arc4FixtureEntry[]): Buffer {
	const names: Buffer[] = [];
	const nameOffsets: number[] = [];
	let namesLength = 0;
	for (const entry of entries) {
		const name = Buffer.from(`${entry.name}\0`, "latin1");
		nameOffsets.push(namesLength);
		names.push(Buffer.concat([name, Buffer.alloc(name.length % 2)]));
		namesLength += name.length + (name.length % 2);
	}
	const payloads = entries.map((entry, index) => {
		const stream = entryStream(entry, index);
		const count = entry.segments ?? 1;
		const parts: Buffer[] = [];
		const size = Math.max(1, Math.floor(stream.length / count));
		for (let part = 0; part < count; part += 1)
			parts.push(stream.subarray(part * size, (part + 1) * size));
		if (count > 1) parts[count - 1] = stream.subarray((count - 1) * size);
		return parts;
	});
	// The index is built twice: first to learn its size, then with the resolved segment addresses.
	const buildIndex = (base: number): Buffer => {
		const records: Buffer[] = [];
		const table: number[] = [];
		let segmentAddress = base;
		for (const [index, parts] of payloads.entries()) {
			const first = table.length;
			for (const part of parts) {
				table.push(segmentAddress);
				segmentAddress += SEGMENT_HEADER_SIZE + part.length;
			}
			const record = Buffer.alloc(8);
			const nameOffset = nameOffsets[index] ?? 0;
			record.writeUIntBE(nameOffset / 2, 0, 3);
			record[3] = (entries[index]?.name.length ?? 0) & 0xff;
			record[4] = parts.length;
			// A single segment record addresses the entry directly, otherwise it indexes the table.
			record.writeUIntBE(
				parts.length === 1 ? (table[first] ?? 0) : first,
				5,
				3,
			);
			records.push(record);
		}
		return Buffer.concat([
			Buffer.concat(records),
			Buffer.concat(names),
			Buffer.from(
				table.flatMap((address) => [
					(address >> 16) & 0xff,
					(address >> 8) & 0xff,
					address & 0xff,
				]),
			),
		]);
	};
	const namesRel = entries.length * 8;
	const tableRel = namesRel + namesLength;
	const placeholder = buildIndex(0);
	const indexOffset = HEADER_SIZE;
	const streamLength = tzStored(placeholder).length;
	const base = indexOffset + streamLength;
	const index = buildIndex(base);
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("ARC4", 0, "latin1");
	header.writeUInt32LE(0x010000, 4);
	header.writeUInt32LE(tzStored(index).length, 8);
	header.writeUInt32LE(1, 0xc);
	header.writeInt32LE(entries.length, 0x10);
	header.writeInt32LE(indexOffset, 0x14);
	header.writeInt32LE(indexOffset + namesRel, 0x1c);
	header.writeInt32LE(indexOffset + tableRel, 0x24);
	header.writeUInt32LE(0, 0x2c);
	const stored: Buffer[] = [];
	for (const parts of payloads)
		for (const part of parts) {
			const segmentHeader = Buffer.alloc(SEGMENT_HEADER_SIZE);
			segmentHeader.writeUInt32BE(part.length, 4);
			stored.push(segmentHeader, part);
		}
	return Buffer.concat([header, tzStored(index), ...stored]);
}

function sourceOf(file: Buffer): BufferByteSource {
	return new BufferByteSource(file);
}

describe("caramel box arc4", () => {
	it("declines a file with the wrong version", async () => {
		const file = buildArc4([{ name: "a.bin", data: Buffer.from("body") }]);
		file.writeUInt32LE(0x020000, 4);
		expect(await caramelBoxArc4Format.detect(sourceOf(file))).toBe(false);
	});

	it("declines an index without the compressed marker", async () => {
		const file = buildArc4([{ name: "a.bin", data: Buffer.from("body") }]);
		file.write("xx", HEADER_SIZE, "latin1");
		expect(await caramelBoxArc4Format.detect(sourceOf(file))).toBe(false);
	});

	it("lists and extracts a plain entry", async () => {
		const data = Buffer.from("first payload");
		const file = buildArc4([{ name: "DATA.BIN", data }]);
		const source = sourceOf(file);
		expect(await caramelBoxArc4Format.detect(source)).toBe(true);
		const archive = await caramelBoxArc4Format.open(source, "GAME.BIN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual(["DATA.BIN"]);
			expect(Number(archive.entries[0]?.size)).toBe(data.length);
			expect(archive.entries[0]?.compressed).toBe(false);
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("extracts an entry whose single block is stored", async () => {
		const data = Buffer.from("stored block payload");
		const file = buildArc4([{ name: "DATA.BIN", data, packed: "stored" }]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc4Format.open(source, "GAME.BIN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.compressed).toBe(true);
			expect(entry.sizeKnown).toBe(false);
			expect(Number(entry.size)).toBe(data.length);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("extracts an entry packed with literals", async () => {
		const data = Buffer.from("literal packed payload bytes");
		const file = buildArc4([{ name: "DATA.BIN", data, packed: "literals" }]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc4Format.open(source, "GAME.BIN");
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

	it("resolves a back reference inside a packed block", async () => {
		// The block writes four literals and then copies three bytes from four bytes back.
		const data = Buffer.from("abcd");
		const file = buildArc4([{ name: "DATA.BIN", data, packed: "match" }]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc4Format.open(source, "GAME.BIN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			// The stream says seven bytes: the four literals and the three copied bytes.
			expect(Number(entry.size)).toBe(7);
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				Buffer.from("abcdabc", "latin1"),
			);
		} finally {
			await archive.close();
		}
	});

	it("concatenates segments before unpacking", async () => {
		const data = Buffer.from("segmented payload that spans two parts");
		const file = buildArc4([
			{ name: "DATA.BIN", data, packed: "literals", segments: 2 },
		]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc4Format.open(source, "GAME.BIN");
		try {
			const entry = archive.entries[0];
			if (!entry) throw new Error("missing entry");
			expect(entry.metadata).toMatchObject({ packed: true });
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				data,
			);
		} finally {
			await archive.close();
		}
	});

	it("lists several entries and splits their segments", async () => {
		const first = Buffer.from("one");
		const second = Buffer.from("second payload");
		const file = buildArc4([
			{ name: "A.BIN", data: first },
			{ name: "B.BIN", data: second, segments: 2 },
		]);
		const source = sourceOf(file);
		const archive = await caramelBoxArc4Format.open(source, "GAME.BIN");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"A.BIN",
				"B.BIN",
			]);
			expect(archive.metadata).toMatchObject({ entryCount: 2 });
			const entry = archive.entries[1];
			if (!entry) throw new Error("missing entry");
			expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
				second,
			);
		} finally {
			await archive.close();
		}
	});
});
