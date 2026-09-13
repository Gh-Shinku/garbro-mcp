import { BufferByteSource } from "@garbro-mcp/core";
import { abelArcFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";

const INDEX_OFFSET = 0x18;
const INDEX_ENTRY_SIZE = 0x26;
const NAME_SIZE = 30;

interface IndexRecord {
	name: string;
	offset: number;
	size: number;
}

/** Encodes the uncompressed index: a 30-byte name followed by the payload offset and size. */
function encodeIndex(records: readonly IndexRecord[]): Buffer {
	const index = Buffer.alloc(records.length * INDEX_ENTRY_SIZE);
	for (const [id, record] of records.entries()) {
		const start = id * INDEX_ENTRY_SIZE;
		Buffer.from(record.name, "latin1").copy(index, start, 0, NAME_SIZE - 1);
		index.writeUInt32LE(record.offset, start + NAME_SIZE);
		index.writeUInt32LE(record.size, start + NAME_SIZE + 4);
	}
	return index;
}

/** Wraps an index and payload region into an archive. The base offset is the archive size. */
function buildFromIndex(index: Buffer, payloads: Buffer): Buffer {
	const storedIndex = literalLzssStream(index);
	const header = Buffer.alloc(INDEX_OFFSET);
	header.write("arc\0", 0, "ascii");
	header.writeInt32LE(index.length / INDEX_ENTRY_SIZE, 8);
	// The base offset is the start of the payload region, which follows the packed index.
	header.writeUInt32LE(INDEX_OFFSET + storedIndex.length, 0xc);
	header.writeUInt32LE(storedIndex.length, 0x10);
	header.writeInt32LE(index.length, 0x14);
	return Buffer.concat([header, storedIndex, payloads]);
}

function buildArc(
	entries: readonly { name: string; payload: Buffer }[],
): Buffer {
	let offset = 0;
	const records: IndexRecord[] = [];
	for (const entry of entries) {
		records.push({
			name: entry.name,
			offset,
			size: entry.payload.length,
		});
		offset += entry.payload.length;
	}
	return buildFromIndex(
		encodeIndex(records),
		Buffer.concat(entries.map((entry) => entry.payload)),
	);
}

describe("ADVEngine ARC resource archive", () => {
	it("reads an lzss index and extracts plain entries", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const archive = buildArc([
			{ name: "one.bin", payload: first },
			{ name: "two.bin", payload: second },
		]);
		await expectArchive({
			format: abelArcFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{ path: "one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
		});
	});

	it("decodes CMP containers and falls back for other layouts", async () => {
		const packed = Buffer.from("cmp compressed payload");
		const stream = literalLzssStream(packed);
		// The container lists the sub-range offset at +8, then a flag byte, an unused word and the
		// packed size at +5, with the LZSS stream at +0x11.
		const container = Buffer.alloc(0x11 + 0x11 + stream.length, 0xaa);
		container.write("CMP\0", 0, "ascii");
		container.writeUInt32LE(0x11, 8);
		container[0x11] = 0;
		container.writeUInt32LE(stream.length, 0x11 + 5);
		stream.copy(container, 0x11 + 0x11);

		const plain = Buffer.from("plain cmp payload");
		const plainContainer = Buffer.alloc(0x11 + plain.length, 0xbb);
		plainContainer.write("CMP\0", 0, "ascii");
		plainContainer.writeUInt32LE(0x11, 8);
		plainContainer[0x11] = 1;
		plain.copy(plainContainer, 0x11);

		const archive = buildArc([
			{ name: "packed.cmp", payload: container },
			{ name: "plain.cmp", payload: plainContainer },
		]);
		await expectArchive({
			format: abelArcFormat,
			archive,
			entries: [
				{ path: "packed.cmp", size: container.length, content: packed },
				{
					path: "plain.cmp",
					size: plainContainer.length,
					content: plainContainer.subarray(0x11),
				},
			],
		});
	});

	it("xor-decodes acd payloads and types them as scripts", async () => {
		const body = Buffer.from("script body");
		const payload = Buffer.concat([
			Buffer.from("ACD\0", "ascii"),
			Buffer.alloc(4, 0x7f),
			body,
		]);
		const archive = buildArc([{ name: "scene.acd", payload }]);
		const expected = Buffer.from(payload);
		for (let index = 8; index < expected.length; index += 1) {
			expected[index] = 0xff - (expected[index] ?? 0);
		}
		await expectArchive({
			format: abelArcFormat,
			archive,
			entries: [{ path: "scene.acd", size: payload.length, content: expected }],
		});
		const source = new BufferByteSource(archive);
		const listing = await abelArcFormat.open(source, "sample.arc");
		try {
			expect(listing.entries[0]?.metadata).toEqual({ type: "script" });
		} finally {
			await listing.close();
		}
	});

	it("rejects an index size that disagrees with the count", async () => {
		const archive = buildArc([
			{ name: "one.bin", payload: Buffer.from("payload") },
		]);
		// Two records' worth of index size against a single-record count.
		archive.writeInt32LE(INDEX_ENTRY_SIZE * 2, 0x14);
		const source = new BufferByteSource(archive);
		expect(await abelArcFormat.detect(source)).toBe(false);
	});

	it("rejects a base offset that points into the header", async () => {
		const archive = buildArc([
			{ name: "one.bin", payload: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(0x10, 0xc);
		const source = new BufferByteSource(archive);
		expect(await abelArcFormat.detect(source)).toBe(false);
	});

	it("rejects an entry that falls outside the archive", async () => {
		const index = encodeIndex([{ name: "one.bin", offset: 0, size: 0x1000 }]);
		const archive = buildFromIndex(index, Buffer.from("payload"));
		const source = new BufferByteSource(archive);
		expect(await abelArcFormat.detect(source)).toBe(false);
	});
});
