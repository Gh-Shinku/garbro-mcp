import { BufferByteSource, type ByteSource } from "@garbro-mcp/core";
import { gamesystemCmpFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SIGNATURE = 0x4b434150; // 'PACK'

interface Record {
	name: string;
	offset: number;
	packed?: boolean;
}

/** Encodes data as literal runs, which is what the format's LZ decoder expects for uncompressible input. */
function packLiterals(data: Buffer): Buffer {
	const output: Buffer[] = [];
	for (let position = 0; position < data.length; position += 128) {
		const chunk = data.subarray(
			position,
			Math.min(position + 128, data.length),
		);
		output.push(Buffer.from([chunk.length - 1]), chunk);
	}
	return Buffer.concat(output);
}

/**
 * Builds the unpacked index: a leading payload offset, one record per entry and a zero name length that ends
 * the walk. Each record carries the next entry's offset, so the last one holds the index offset.
 */
function buildIndex(records: readonly Record[], endOffset: number): Buffer {
	const parts: Buffer[] = [Buffer.alloc(4)];
	records.forEach((record, index) => {
		const name = Buffer.from(record.name, "utf16le");
		const header = Buffer.alloc(6);
		header.writeUInt8(name.length / 2, 0);
		header.writeUInt8(record.packed === true ? 1 : 0, 1);
		const nextOffset = records[index + 1]?.offset ?? endOffset;
		const tail = Buffer.alloc(4);
		tail.writeUInt32LE(nextOffset, 0);
		parts.push(header, name, tail);
	});
	parts.push(Buffer.from([0]));
	const body = Buffer.concat(parts);
	body.writeUInt32LE(records[0]?.offset ?? endOffset, 0);
	return body;
}

/**
 * Wraps an unpacked index in the LZ stream and the two-word trailer. The index offset in the trailer points at
 * the unpacked size word, so the payload area ends where that word begins.
 */
function buildCmp(payloads: readonly Buffer[], body: Buffer): Buffer {
	const payloadArea = Buffer.concat([...payloads]);
	const size = Buffer.alloc(4);
	size.writeUInt32LE(body.length, 0);
	const trailer = Buffer.alloc(8);
	trailer.writeUInt32LE(payloadArea.length, 0);
	trailer.writeUInt32LE(SIGNATURE, 4);
	return Buffer.concat([payloadArea, size, packLiterals(body), trailer]);
}

/** A packed payload: the unpacked size followed by an LZ stream. */
function packPayload(content: Buffer): Buffer {
	const size = Buffer.alloc(4);
	size.writeUInt32LE(content.length, 0);
	return Buffer.concat([size, packLiterals(content)]);
}

describe("'GameSystem' engine resource archive", () => {
	it("lists stored and packed entries", async () => {
		const stored = Buffer.from("stored payload");
		const unpacked = Buffer.from("packed payload contents");
		const packed = packPayload(unpacked);
		const records: Record[] = [
			{ name: "one.bin", offset: 0 },
			{ name: "dir\\two.bin", offset: stored.length, packed: true },
		];
		const indexOffset = stored.length + packed.length;
		const body = buildIndex(records, indexOffset);
		const archive = buildCmp([stored, packed], body);
		await expectArchive({
			format: gamesystemCmpFormat,
			archive,
			entries: [
				{ path: "one.bin", size: stored.length, content: stored },
				{ path: "dir/two.bin", size: unpacked.length, content: unpacked },
			],
			metadata: { entryCount: 2, indexOffset, indexSize: body.length },
		});
	});

	it("decodes an LZ match", async () => {
		// A literal 'A', then a match copying two bytes from distance one, then another literal run.
		const stream = Buffer.concat([
			Buffer.from([0x00, 0x41]),
			Buffer.from([0x80, 0x00]),
			Buffer.from([0x00, 0x42]),
		]);
		const unpacked = Buffer.from("AAAB");
		const size = Buffer.alloc(4);
		size.writeUInt32LE(unpacked.length, 0);
		const packed = Buffer.concat([size, stream]);
		const body = buildIndex(
			[{ name: "one.bin", offset: 0, packed: true }],
			packed.length,
		);
		const archive = buildCmp([packed], body);
		await expectArchive({
			format: gamesystemCmpFormat,
			archive,
			entries: [{ path: "one.bin", size: unpacked.length, content: unpacked }],
		});
	});

	it("stops the walk at a zero name length", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const indexOffset = first.length + second.length;
		// A well-formed record follows the terminator, which the walk must never reach.
		const trailing = Buffer.alloc(6 + 14 + 4, 0);
		trailing.writeUInt8(7, 0);
		Buffer.from("two.bin", "utf16le").copy(trailing, 6);
		const body = Buffer.concat([
			buildIndex([{ name: "one.bin", offset: 0 }], indexOffset),
			trailing,
		]);
		const archive = buildCmp([first, second], body);
		// The single record spans the whole payload area, since the walk never reaches the second record.
		await expectArchive({
			format: gamesystemCmpFormat,
			archive,
			entries: [
				{
					path: "one.bin",
					size: indexOffset,
					content: Buffer.concat([first, second]),
				},
			],
		});
	});

	it("rejects a file without the trailer signature", async () => {
		const body = buildIndex([{ name: "one.bin", offset: 0 }], 4);
		const archive = buildCmp([Buffer.from("data")], body);
		archive.writeUInt32LE(0x4b434151, archive.length - 4);
		await expectDeclined(archive);
	});

	it("rejects a file too short for its trailer", async () => {
		await expectDeclined(Buffer.alloc(8));
	});

	it("rejects an index offset outside the file", async () => {
		const body = buildIndex([{ name: "one.bin", offset: 0 }], 4);
		const archive = buildCmp([Buffer.from("data")], body);
		archive.writeUInt32LE(0x1000, archive.length - 8);
		await expectDeclined(archive);
	});

	it("rejects a non-positive index size", async () => {
		const body = buildIndex([{ name: "one.bin", offset: 0 }], 4);
		const archive = buildCmp([Buffer.from("data")], body);
		const indexOffset = archive.readUInt32LE(archive.length - 8);
		archive.writeInt32LE(0, indexOffset);
		await expectDeclined(archive);
	});

	it("rejects a payload that reaches into the index", async () => {
		const stored = Buffer.from("stored payload");
		const archive = buildCmp(
			[stored],
			buildIndex([{ name: "one.bin", offset: 0 }], 0x1000),
		);
		await expectDeclined(archive);
	});

	it("rejects a truncated LZ stream", async () => {
		const stored = Buffer.from("stored payload");
		const body = buildIndex([{ name: "one.bin", offset: 0 }], stored.length);
		const archive = buildCmp([stored], body);
		// Claim a larger unpacked index than the stored stream can provide.
		archive.writeUInt32LE(body.length + 100, stored.length);
		await expectDeclined(archive);
	});
});

async function expectDeclined(archive: Buffer): Promise<void> {
	const source: ByteSource = new BufferByteSource(archive);
	expect(await gamesystemCmpFormat.detect(source, "sample.cmp")).toBe(false);
}
