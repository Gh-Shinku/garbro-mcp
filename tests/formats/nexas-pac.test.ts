import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { nexasPacFormat } from "@garbro-mcp/formats";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const HEADER_SIZE = 0xc;
const NAME_LENGTH = 0x20;
const LONG_NAME_LENGTH = 0x40;

/** Packs bits most-significant-first, matching GARbro's `MsbBitStream`. */
function packBits(bits: readonly number[]): Buffer {
	const output = Buffer.alloc(Math.ceil(bits.length / 8));
	for (const [index, bit] of bits.entries()) {
		if (bit === 0) continue;
		const byte = Math.floor(index / 8);
		output[byte] = (output[byte] ?? 0) | (1 << (7 - (index % 8)));
	}
	return output;
}

/**
 * Builds a huffman stream over the symbols the data actually uses, padded to a complete tree. A smaller symbol
 * set keeps the tree short enough for the reference's two-to-one bound on the index size.
 */
function huffmanStream(data: Buffer): Buffer {
	const symbols = [...new Set([...data])].sort((left, right) => left - right);
	let size = 1;
	while (size < symbols.length) size *= 2;
	const leaves = [...symbols];
	while (leaves.length < size) leaves.push(symbols[0] ?? 0);
	const depth = Math.round(Math.log2(size));
	const bits: number[] = [];
	const writeTree = (minimum: number, count: number): void => {
		if (count === 1) {
			bits.push(
				0,
				...(leaves[minimum] ?? 0)
					.toString(2)
					.padStart(8, "0")
					.split("")
					.map(Number),
			);
			return;
		}
		bits.push(1);
		writeTree(minimum, count / 2);
		writeTree(minimum + count / 2, count / 2);
	};
	writeTree(0, size);
	for (const value of data) {
		const code = leaves.indexOf(value);
		for (let shift = depth - 1; shift >= 0; shift -= 1)
			bits.push((code >> shift) & 1);
	}
	return packBits(bits);
}

interface EntrySource {
	name: string;
	payload: Buffer;
	unpackedSize?: number;
}

/** Writes a fixed length name, padded with zeroes. */
function writeName(name: string, length: number): Buffer {
	const field = Buffer.alloc(length);
	Buffer.from(encodeCp932(name)).copy(field, 0, 0, length);
	return field;
}

function buildRecords(
	sources: readonly EntrySource[],
	nameLength: number,
	offsetBase: number,
): { block: Buffer; payloads: Buffer } {
	const records = Buffer.alloc(sources.length * (nameLength + 12));
	const payloads: Buffer[] = [];
	let cursor = offsetBase;
	for (const [i, source] of sources.entries()) {
		const start = i * (nameLength + 12);
		writeName(source.name, nameLength).copy(records, start);
		records.writeUInt32LE(cursor, start + nameLength);
		records.writeUInt32LE(
			source.unpackedSize ?? source.payload.length,
			start + nameLength + 4,
		);
		records.writeUInt32LE(source.payload.length, start + nameLength + 8);
		payloads.push(source.payload);
		cursor += source.payload.length;
	}
	return { block: records, payloads: Buffer.concat(payloads) };
}

/** Builds an old layout archive whose index sits right behind the header. */
function buildOld(
	sources: readonly EntrySource[],
	method = 0,
	nameLength = NAME_LENGTH,
): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("PAC", 0, "latin1");
	header.writeInt32LE(sources.length, 4);
	header.writeInt32LE(method, 8);
	const dataOffset = HEADER_SIZE + sources.length * (nameLength + 12);
	const { block, payloads } = buildRecords(sources, nameLength, dataOffset);
	return Buffer.concat([header, block, payloads]);
}

/** Builds a new layout archive whose complemented huffman index ends the file. */
function buildNew(sources: readonly EntrySource[], method: number): Buffer {
	const header = Buffer.alloc(HEADER_SIZE);
	header.write("PAC", 0, "latin1");
	header.writeInt32LE(sources.length, 4);
	header.writeInt32LE(method, 8);
	const { block, payloads } = buildRecords(
		sources,
		LONG_NAME_LENGTH,
		HEADER_SIZE,
	);
	const index = huffmanStream(block);
	for (let i = 0; i < index.length; i += 1) index[i] = ~(index[i] ?? 0) & 0xff;
	const trailer = Buffer.alloc(4);
	trailer.writeUInt32LE(index.length, 0);
	return Buffer.concat([header, payloads, index, trailer]);
}

async function expectDeclined(file: Buffer): Promise<void> {
	const source = new BufferByteSource(file);
	expect(await nexasPacFormat.detect(source, "sample.pac")).toBe(false);
}

describe("NeXAS engine resource archive", () => {
	it("lists an old index with stored entries", async () => {
		const first = Buffer.from("stored payload");
		const second = Buffer.from("second stored payload");
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildOld([
				{ name: "first.dat", payload: first },
				{ name: "second.dat", payload: second },
			]),
			entries: [
				{ path: "first.dat", size: first.length, content: first },
				{ path: "second.dat", size: second.length, content: second },
			],
			metadata: { entryCount: 2, method: 0 },
		});
	});

	it("retries the old index with sixty-four byte names", async () => {
		// A name longer than thirty-two bytes makes the first attempt read record fields out of the name.
		const payload = Buffer.from("long name payload");
		const name = "a-long-file-name-that-overflows-the-short-record.dat";
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildOld([{ name, payload }], 0, LONG_NAME_LENGTH),
			entries: [{ path: name, size: payload.length, content: payload }],
		});
	});

	it("lists a new index that is huffman coded and complemented", async () => {
		const payload = Buffer.from("huffman indexed payload");
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildNew([{ name: "indexed.dat", payload }], 0),
			entries: [
				{ path: "indexed.dat", size: payload.length, content: payload },
			],
		});
	});

	it("unpacks an lzss payload", async () => {
		const payload = Buffer.from("lzss payload");
		const stored = literalLzssStream(payload);
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildOld(
				[{ name: "packed.dat", payload: stored, unpackedSize: payload.length }],
				1,
			),
			entries: [{ path: "packed.dat", size: payload.length, content: payload }],
			metadata: { entryCount: 1, method: 1 },
		});
	});

	it("unpacks a huffman payload", async () => {
		const payload = Buffer.from("huffman payload data");
		const stored = huffmanStream(payload);
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildOld(
				[{ name: "packed.dat", payload: stored, unpackedSize: payload.length }],
				2,
			),
			entries: [{ path: "packed.dat", size: payload.length, content: payload }],
		});
	});

	it("unpacks a deflate payload", async () => {
		const payload = Buffer.from("deflate payload");
		const stored = deflateSync(payload);
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildOld(
				[{ name: "packed.dat", payload: stored, unpackedSize: payload.length }],
				3,
			),
			entries: [{ path: "packed.dat", size: payload.length, content: payload }],
		});
	});

	it("keeps an entry whose deflate sizes agree stored", async () => {
		const payload = Buffer.from("already stored");
		const archive = await nexasPacFormat.open(
			new BufferByteSource(
				buildOld(
					[{ name: "plain.dat", payload, unpackedSize: payload.length }],
					4,
				),
			),
			"sample.pac",
		);
		expect(archive.entries[0]).toMatchObject({
			compressed: false,
			size: BigInt(payload.length),
		});
	});

	it("unpacks an entry whose deflate sizes differ", async () => {
		const payload = Buffer.from("deflate or none payload");
		const stored = deflateSync(payload);
		await expectArchive({
			format: nexasPacFormat,
			sourcePath: "sample.pac",
			archive: buildOld(
				[{ name: "packed.dat", payload: stored, unpackedSize: payload.length }],
				4,
			),
			entries: [{ path: "packed.dat", size: payload.length, content: payload }],
		});
	});

	it("rejects the older PACK signature", async () => {
		const file = buildOld([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt8(0x4b, 3);
		await expectDeclined(file);
	});

	it("rejects a file without entries", async () => {
		const file = buildOld([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeInt32LE(0, 4);
		await expectDeclined(file);
	});

	it("rejects an entry that leaves the file", async () => {
		const file = buildOld([{ name: "first.dat", payload: Buffer.from("x") }]);
		file.writeUInt32LE(file.length * 8, HEADER_SIZE + NAME_LENGTH);
		await expectDeclined(file);
	});
});
