import { type ArchiveEntry, BufferByteSource } from "@garbro-mcp/core";
import { buildAxrKeyTable, vnEngineAxrFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const HEADER_SIZE = 0x10;
const KEY_TABLE_SIZE = 0x400;
const SIGNATURE_BYTES = Buffer.from("AXRe", "latin1");
const SIGNATURE_WORD = SIGNATURE_BYTES.readUInt32LE(0);

interface AxrEntry {
	name: string;
	content: Buffer;
}

interface BuildOptions {
	/** Replaces the key derived from the index size, which keeps the checksum valid. */
	indexSizeOverride?: number;
	/** Patches the unpacked index before it is encrypted. */
	mutateIndex?: (index: Buffer) => void;
	seed?: number;
}

function rotateByteRight(value: number, count: number): number {
	return ((value >>> count) | (value << (8 - count))) & 0xff;
}

/** GARbro `AxrOpener.MutateKey`. */
function mutateKey(key: number): number {
	let value = key >>> 0;
	value = (value ^ (((value & 0xfff) << 17) >>> 0)) >>> 0;
	const rotated = (((value << 18) >>> 0) | (value >>> 15)) >>> 0;
	return ~(value ^ rotated) >>> 0;
}

/**
 * GARbro `AxrOpener.Decrypt`, word by word. The key schedule adds the decrypted word, so this doubles
 * as the keystream generator for a zero buffer.
 */
function decryptWords(data: Buffer, key: number): Buffer {
	const output = Buffer.from(data);
	let cursor = key >>> 0;
	for (let offset = 0; offset + 4 <= output.length; offset += 4) {
		cursor = mutateKey(cursor);
		const value = (output.readUInt32LE(offset) ^ cursor) >>> 0;
		output.writeUInt32LE(value, offset);
		cursor = (cursor + value) >>> 0;
	}
	return output;
}

/**
 * The inverse of the cipher: the schedule advances by the plaintext word, which is what the decrypt
 * routine adds once it has recovered it. Asserted against {@link decryptWords} below.
 */
function encryptWords(plain: Buffer, key: number): Buffer {
	const output = Buffer.alloc(plain.length);
	let cursor = key >>> 0;
	for (let offset = 0; offset + 4 <= plain.length; offset += 4) {
		cursor = mutateKey(cursor);
		const value = plain.readUInt32LE(offset);
		output.writeUInt32LE((value ^ cursor) >>> 0, offset);
		cursor = (cursor + value) >>> 0;
	}
	return output;
}

/** Builds the unpacked index: offset, size and a padded CP932 name, then a terminating zero. */
function buildIndex(entries: readonly AxrEntry[], payloadBase: number): Buffer {
	const chunks: Buffer[] = [];
	let running = payloadBase;
	for (const entry of entries) {
		const name = Buffer.from(entry.name, "latin1");
		const record = Buffer.alloc(8 + name.length);
		record.writeUInt32LE(running, 0);
		record.writeUInt32LE(entry.content.length, 4);
		name.copy(record, 8);
		chunks.push(record);
		const padding = (name.length + 4) & ~3;
		chunks.push(Buffer.alloc(padding - name.length));
		running += entry.content.length;
	}
	chunks.push(Buffer.alloc(4));
	return Buffer.concat(chunks);
}

/** Encrypts a payload with the archive keystream at its absolute offset. */
function encryptPayload(plain: Buffer, offset: number, table: Buffer): Buffer {
	const output = Buffer.from(plain);
	for (let index = 0; index < output.length; index += 1)
		output[index] =
			(output[index] ?? 0) ^
			(table[(offset + index) & (KEY_TABLE_SIZE - 1)] ?? 0);
	return output;
}

/** Builds a complete AXR archive in the reference's own format. */
function buildArchive(
	entries: readonly AxrEntry[],
	options: BuildOptions = {},
): Buffer {
	// The index length does not depend on the payload base, so the layout is sized first.
	const payloadBase = HEADER_SIZE + buildIndex(entries, 0).length;
	const index = buildIndex(entries, payloadBase);
	options.mutateIndex?.(index);
	const seed = options.seed ?? 0x11223344;
	const t = mutateKey(mutateKey((seed ^ SIGNATURE_WORD) >>> 0));
	const indexSize = options.indexSizeOverride ?? index.length;
	const key = (t ^ indexSize) >>> 0;

	const header = Buffer.alloc(HEADER_SIZE);
	SIGNATURE_BYTES.copy(header, 0);
	header.writeUInt32LE(key, 4);
	header.writeUInt32LE(seed, 8);
	let checksum = header[4] ?? 0;
	for (let position = 1; position < 8; position += 1)
		checksum ^= rotateByteRight(header[4 + position] ?? 0, position);
	header.writeUInt32LE((checksum ^ mutateKey(t)) >>> 0, 12);

	const table = decryptWords(Buffer.alloc(KEY_TABLE_SIZE), key);
	const body = Buffer.concat([
		encryptWords(index, key),
		...entries.map((entry, position) => {
			const offset =
				payloadBase +
				entries
					.slice(0, position)
					.reduce((total, item) => total + item.content.length, 0);
			return encryptPayload(entry.content, offset, table);
		}),
	]);
	return Buffer.concat([header, body]);
}

describe("vnengine AXR resource archive", () => {
	it("matches the reference keystream schedule", () => {
		// Golden words of the payload table for key 0x12345678, computed from the C# schedule
		// (each word is `MutateKey` of twice the previous one).
		const table = buildAxrKeyTable(0x12345678);
		expect(table.readUInt32LE(0)).toBe(0xb8db940f);
		expect(table.readUInt32LE(4)).toBe(0x3e0c14f7);
		expect(table.readUInt32LE(8)).toBe(0x37830999);
		expect(table.readUInt32LE(12)).toBe(0xda553e09);
	});

	it("round trips the index cipher", () => {
		const plain = Buffer.from([
			0x10, 0x20, 0x30, 0x40, 0xff, 0x00, 0x7f, 0x80, 0x01, 0x02, 0x03, 0x04,
		]);
		expect(decryptWords(encryptWords(plain, 0xdeadbeef), 0xdeadbeef)).toEqual(
			plain,
		);
	});

	it("lists entries and decrypts their payloads", async () => {
		const first = Buffer.from("first payload, repeated payload");
		const second = Buffer.from("second payload");
		await expectArchive({
			format: vnEngineAxrFormat,
			archive: buildArchive([
				{ name: "FIRST.BIN", content: first },
				{ name: "DIR\\SECOND.BIN", content: second },
			]),
			sourcePath: "sample.axr",
			entries: [
				{ path: "FIRST.BIN", size: first.length, content: first },
				{ path: "DIR/SECOND.BIN", size: second.length, content: second },
			],
		});
	});

	it("wraps the keystream for payloads longer than the table", async () => {
		const content = Buffer.alloc(0x600);
		for (let index = 0; index < content.length; index += 1)
			content[index] = (index * 11) & 0xff;
		await expectArchive({
			format: vnEngineAxrFormat,
			archive: buildArchive([{ name: "LONG.BIN", content }]),
			sourcePath: "sample.axr",
			entries: [{ path: "LONG.BIN", size: content.length, content }],
		});
	});

	it("uses the absolute offset for the keystream", async () => {
		const first = Buffer.from("padding");
		const second = Buffer.from("second payload");
		const archive = buildArchive([
			{ name: "A.BIN", content: first },
			{ name: "B.BIN", content: second },
		]);
		const source = new BufferByteSource(archive);
		const handle = await vnEngineAxrFormat.open(source, "sample.axr");
		const entry = handle.entries[1];
		if (!entry) throw new Error("Missing entry");
		expect(await consumeBuffer(await handle.openEntry(entry.id))).toEqual(
			second,
		);
		// The second payload starts partway through the table, so a per-entry offset would fail.
		const offset = (entry as ArchiveEntry & { offset: bigint }).offset;
		expect(Number(offset) % KEY_TABLE_SIZE).not.toBe(0);
	});

	it("rejects a checksum mismatch", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.writeUInt8((archive[12] ?? 0) ^ 0xff, 12);
		expect(
			await vnEngineAxrFormat.detect(
				new BufferByteSource(archive),
				"sample.axr",
			),
		).toBe(false);
	});

	it("rejects an index smaller than its header", async () => {
		const archive = buildArchive(
			[{ name: "A.BIN", content: Buffer.from("payload") }],
			{ indexSizeOverride: 4 },
		);
		expect(
			await vnEngineAxrFormat.detect(
				new BufferByteSource(archive),
				"sample.axr",
			),
		).toBe(false);
	});

	it("rejects an index that reaches past the archive", async () => {
		const archive = buildArchive(
			[{ name: "A.BIN", content: Buffer.from("payload") }],
			{ indexSizeOverride: 0x10000 },
		);
		expect(
			await vnEngineAxrFormat.detect(
				new BufferByteSource(archive),
				"sample.axr",
			),
		).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildArchive(
			[{ name: "A.BIN", content: Buffer.from("payload") }],
			{ mutateIndex: (index) => index.writeUInt32LE(0x1000, 0) },
		);
		expect(
			await vnEngineAxrFormat.detect(
				new BufferByteSource(archive),
				"sample.axr",
			),
		).toBe(false);
	});

	it("rejects a foreign signature", async () => {
		const archive = buildArchive([
			{ name: "A.BIN", content: Buffer.from("payload") },
		]);
		archive.write("AXRf", 0, "latin1");
		expect(
			await vnEngineAxrFormat.detect(
				new BufferByteSource(archive),
				"sample.axr",
			),
		).toBe(false);
	});

	it("rejects an index without entries", async () => {
		const archive = buildArchive(
			[{ name: "A.BIN", content: Buffer.from("payload") }],
			{ mutateIndex: (index) => index.fill(0) },
		);
		expect(
			await vnEngineAxrFormat.detect(
				new BufferByteSource(archive),
				"sample.axr",
			),
		).toBe(false);
	});
});
