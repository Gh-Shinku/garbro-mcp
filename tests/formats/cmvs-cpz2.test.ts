import { BufferByteSource } from "@garbro-mcp/core";
import { cpz2Format, decryptCpz2 } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const INDEX_OFFSET = 0x14;
const NAME_OFFSET = 0x18;
const WORD_SUBTRACT = 0x15c3e7;
const BYTE_ADD = 0x37;
/** The LZSS container keeps its payload behind a 0x30-byte header. */
const LZSS_HEADER_SIZE = 0x30;

const ENCRYPTION_TABLE = Uint32Array.from([
	0x3a68cdbf, 0xd3c3a711, 0x8414876e, 0x657befdb, 0xcdd7c125, 0x09328580,
	0x288ffedd, 0x99ebf13a, 0x5a471f95, 0x1ea3f4f1, 0xf4ff524e, 0xd358e8a9,
	0xc5b71015, 0xa913046f, 0x2d6fd2bd, 0x68c8be19,
]);

function rotateLeft(value: number, count: number): number {
	const shift = count & 0x1f;
	return ((value << shift) | (value >>> (32 - shift))) >>> 0;
}

/** The exact inverse of the reference's decryptor, used to build fixtures. */
function encryptCpz2(data: Buffer, key: number): void {
	let shift = 5;
	let nibbles = key;
	for (let index = 0; index < 8; index += 1) {
		shift ^= nibbles & 0xf;
		nibbles >>>= 4;
	}
	shift += 8;

	let tableIndex = 0;
	const words = data.length >>> 2;
	for (let index = 0; index < words; index += 1) {
		const plain = data.readUInt32LE(index * 4);
		const rotated = rotateLeft(plain, shift);
		const value =
			((rotated + WORD_SUBTRACT) >>> 0) ^
			(((ENCRYPTION_TABLE[tableIndex++ & 0xf] ?? 0) + key) >>> 0);
		data.writeUInt32LE(value >>> 0, index * 4);
	}
	let byteShift = 0;
	for (let index = words * 4; index < data.length; index += 1) {
		const plain = data[index] ?? 0;
		const value =
			((plain - BYTE_ADD) & 0xff) ^
			(((ENCRYPTION_TABLE[tableIndex++ & 0xf] ?? 0) + key) >>> byteShift);
		data[index] = value & 0xff;
		byteShift += 4;
	}
}

/** A `PSS0` container holding `content` as a literal-only CPZ LZSS stream. */
function cpzPayload(content: Buffer): Buffer {
	const header = Buffer.alloc(LZSS_HEADER_SIZE);
	header.write("PSS0", 0, "ascii");
	header.writeInt32LE(content.length, 0x28);
	const chunks: Buffer[] = [header];
	for (let position = 0; position < content.length; position += 8) {
		chunks.push(Buffer.from([0xff]), content.subarray(position, position + 8));
	}
	return Buffer.concat(chunks);
}

interface Entry {
	name: string;
	payload: Buffer;
	key: number;
}

function buildCpz2(entries: readonly Entry[]): Buffer {
	const records = entries.map((entry) => {
		const name = Buffer.from(`${entry.name}\0`, "latin1");
		const record = Buffer.alloc(NAME_OFFSET + name.length);
		record.writeInt32LE(record.length, 0);
		record.writeUInt32LE(entry.payload.length, 4);
		record.writeUInt32LE(0, 8);
		record.writeUInt32LE(entry.key ^ 0x796c3afd, 0x14);
		name.copy(record, NAME_OFFSET);
		return record;
	});
	const indexSize = records.reduce((sum, record) => sum + record.length, 0);
	// Payload offsets are relative to the end of the index, so fill them before concatenating.
	let offset = 0;
	for (const [id, entry] of entries.entries()) {
		records[id]?.writeUInt32LE(offset, 8);
		offset += entry.payload.length;
	}
	const index = Buffer.concat(records);
	const indexKey = 0x12345678;
	encryptCpz2(index, indexKey);
	const payloads = Buffer.concat(
		entries.map((entry) => {
			const payload = Buffer.from(entry.payload);
			encryptCpz2(payload, entry.key);
			return payload;
		}),
	);
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("CPZ2", 0, "ascii");
	header.writeUInt32LE((entries.length ^ 0xe47c59f3) >>> 0, 4);
	header.writeUInt32LE((indexSize ^ 0x3f71de2a) >>> 0, 8);
	header.writeUInt32LE((indexKey ^ 0x40de832c) >>> 0, 0x10);
	return Buffer.concat([header, index, payloads]);
}

describe("CVNS CPZ2 resource archive", () => {
	it("round-trips the payload transform", () => {
		const plain = Buffer.from("0123456789");
		const encrypted = Buffer.from(plain);
		encryptCpz2(encrypted, 0xdeadbeef);
		expect(encrypted).not.toEqual(plain);
		decryptCpz2(encrypted, 0xdeadbeef);
		expect(encrypted).toEqual(plain);
	});

	it("decrypts the index and unpacks PSS0 payloads", async () => {
		const plain = Buffer.from("plain entry payload");
		const packed = Buffer.from("packed entry payload");
		const archive = buildCpz2([
			{ name: "plain.dat", payload: plain, key: 0x11111111 },
			{ name: "packed.dat", payload: cpzPayload(packed), key: 0x22222222 },
		]);
		await expectArchive({
			format: cpz2Format,
			archive,
			sourcePath: "sample.cpz",
			metadata: { entryCount: 2 },
			entries: [
				{ path: "plain.dat", size: plain.length, content: plain },
				{
					path: "packed.dat",
					size: LZSS_HEADER_SIZE + packed.length,
					content: Buffer.concat([
						cpzPayload(packed).subarray(0, LZSS_HEADER_SIZE),
						packed,
					]),
				},
			],
		});
	});

	it("requires the cpz extension", async () => {
		const archive = buildCpz2([
			{ name: "plain.dat", payload: Buffer.from("payload"), key: 1 },
		]);
		const source = new BufferByteSource(archive);
		expect(await cpz2Format.detect(source, "sample.bin")).toBe(false);
		expect(await cpz2Format.detect(source, "sample.cpz")).toBe(true);
	});

	it("rejects an index that runs past the file", async () => {
		const archive = buildCpz2([
			{ name: "plain.dat", payload: Buffer.from("payload"), key: 1 },
		]);
		archive.writeUInt32LE((0x1000 ^ 0x3f71de2a) >>> 0, 8);
		const source = new BufferByteSource(archive);
		expect(await cpz2Format.detect(source, "sample.cpz")).toBe(false);
	});

	it("rejects a record with a non-positive size", async () => {
		const archive = buildCpz2([
			{ name: "plain.dat", payload: Buffer.from("payload"), key: 1 },
		]);
		const index = archive.subarray(INDEX_OFFSET);
		const indexKey = (archive.readUInt32LE(0x10) ^ 0x40de832c) >>> 0;
		decryptCpz2(index, indexKey);
		index.writeInt32LE(0, 0);
		encryptCpz2(index, indexKey);
		const source = new BufferByteSource(archive);
		expect(await cpz2Format.detect(source, "sample.cpz")).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildCpz2([
			{ name: "plain.dat", payload: Buffer.from("payload"), key: 1 },
		]);
		const index = archive.subarray(INDEX_OFFSET);
		const indexKey = (archive.readUInt32LE(0x10) ^ 0x40de832c) >>> 0;
		decryptCpz2(index, indexKey);
		index.writeUInt32LE(0x1000, 8);
		encryptCpz2(index, indexKey);
		const source = new BufferByteSource(archive);
		expect(await cpz2Format.detect(source, "sample.cpz")).toBe(false);
	});
});
