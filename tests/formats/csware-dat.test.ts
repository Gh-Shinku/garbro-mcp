import { deflateSync } from "node:zlib";
import { BufferByteSource } from "@garbro-mcp/core";
import { cswareDatFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const ZLIB_OFFSET = 8;
const NAME_SIZE = 0x18;
const RECORD_SIZE = NAME_SIZE + 8;

interface Entry {
	name: string;
	payload: Buffer;
}

/** Builds the archive: count, packed size and a zlib index, then the payload region. */
function buildDat(entries: readonly Entry[]): Buffer {
	const index = Buffer.alloc(entries.length * RECORD_SIZE);
	let payloadOffset = 0;
	for (const [id, entry] of entries.entries()) {
		const record = id * RECORD_SIZE;
		Buffer.from(entry.name, "latin1").copy(index, record, 0, NAME_SIZE - 1);
		index.writeUInt32LE(payloadOffset, record + NAME_SIZE);
		index.writeUInt32LE(entry.payload.length, record + NAME_SIZE + 4);
		payloadOffset += entry.payload.length;
	}
	const packed = deflateSync(index);
	const header = Buffer.alloc(ZLIB_OFFSET);
	header.writeInt32LE(entries.length, 0);
	header.writeUInt32LE(packed.length, 4);
	return Buffer.concat([
		header,
		packed,
		...entries.map((entry) => entry.payload),
	]);
}

describe("C's Ware BLITZ DAT resource archive", () => {
	it("reads a zlib index and extracts plain entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildDat([
			{ name: "first.bin", payload: first },
			{ name: "second.bin", payload: second },
		]);
		await expectArchive({
			format: cswareDatFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "first.bin", size: first.length, content: first },
				{ path: "second.bin", size: second.length, content: second },
			],
		});
	});

	it("rejects an index without the zlib marker", async () => {
		const archive = buildDat([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		archive[ZLIB_OFFSET] = 0x00;
		const source = new BufferByteSource(archive);
		expect(await cswareDatFormat.detect(source)).toBe(false);
	});

	it("rejects a corrupt zlib index", async () => {
		const archive = buildDat([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		archive.fill(0x7f, ZLIB_OFFSET + 2, ZLIB_OFFSET + 10);
		const source = new BufferByteSource(archive);
		expect(await cswareDatFormat.detect(source)).toBe(false);
	});

	it("rejects a packed size that reaches the end of the file", async () => {
		const archive = buildDat([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(archive.length, 4);
		const source = new BufferByteSource(archive);
		expect(await cswareDatFormat.detect(source)).toBe(false);
	});

	it("rejects a record with an empty name", async () => {
		const archive = buildDat([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		const index = Buffer.alloc(RECORD_SIZE);
		index.writeUInt32LE(0, NAME_SIZE);
		index.writeUInt32LE(6, NAME_SIZE + 4);
		const packed = deflateSync(index);
		const rebuilt = Buffer.alloc(ZLIB_OFFSET);
		rebuilt.writeInt32LE(1, 0);
		rebuilt.writeUInt32LE(packed.length, 4);
		const source = new BufferByteSource(
			Buffer.concat([rebuilt, packed, Buffer.from("payload")]),
		);
		expect(await cswareDatFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const archive = buildDat([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		const index = Buffer.alloc(RECORD_SIZE);
		Buffer.from("first.bin", "latin1").copy(index, 0);
		index.writeUInt32LE(0x1000, NAME_SIZE);
		index.writeUInt32LE(4, NAME_SIZE + 4);
		const packed = deflateSync(index);
		const rebuilt = Buffer.alloc(ZLIB_OFFSET);
		rebuilt.writeInt32LE(1, 0);
		rebuilt.writeUInt32LE(packed.length, 4);
		const source = new BufferByteSource(
			Buffer.concat([rebuilt, packed, Buffer.from("payload")]),
		);
		expect(await cswareDatFormat.detect(source)).toBe(false);
	});

	it("rejects a truncated index", async () => {
		const archive = buildDat([
			{ name: "first.bin", payload: Buffer.from("payload") },
		]);
		// Claim two records while the index only holds one.
		const header = Buffer.from(archive.subarray(0, ZLIB_OFFSET));
		header.writeInt32LE(2, 0);
		const source = new BufferByteSource(
			Buffer.concat([header, archive.subarray(ZLIB_OFFSET)]),
		);
		expect(await cswareDatFormat.detect(source)).toBe(false);
	});
});
