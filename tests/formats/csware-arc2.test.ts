import { encodeCp932 } from "@garbro-mcp/core";
import { arc2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET_OFFSET = 8;
const RECORD_SIZE = 0x20;
const NAME_SIZE = 0x10;

interface Arc2Entry {
	name: string;
	content: Buffer;
	key1?: number;
	key2?: number;
}

/** Inverse of GARbro's key chain: each word gains the sum of the two running keys. */
function encryptPayload(data: Buffer, key1: number, key2: number): Buffer {
	// Both sides only transform complete 32-bit words, so no padding is added.
	const payload = Buffer.from(data);
	let previous = key1 >>> 0;
	let current = key2 >>> 0;
	for (let position = 0; position + 4 <= payload.length; position += 4) {
		const keySum = (previous + current) >>> 0;
		payload.writeUInt32LE(
			(payload.readUInt32LE(position) + keySum) >>> 0,
			position,
		);
		previous = current;
		current = keySum;
	}
	return payload;
}

function buildArc2(entries: readonly Arc2Entry[]): Buffer {
	const count = entries.length;
	const indexOffset = 0x10;
	const dataOffset = indexOffset + count * RECORD_SIZE;
	const parts: Buffer[] = [];
	let size = 0;
	for (const entry of entries) {
		const key1 = entry.key1 ?? 0;
		const key2 = entry.key2 ?? 0;
		const stored =
			(key1 | key2) === 0
				? entry.content
				: encryptPayload(entry.content, key1, key2);
		parts.push(stored);
		size += stored.length;
	}
	const archive = Buffer.concat([Buffer.alloc(dataOffset), ...parts]);
	archive.write("arc2", 0, "ascii");
	archive.writeInt32LE(count, 4);
	archive.writeUInt32LE(indexOffset, INDEX_OFFSET_OFFSET);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		const stored = parts[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		archive.writeUInt32LE(offset, record + 0x14);
		archive.writeUInt32LE(entry.key1 ?? 0, record + 0x18);
		archive.writeUInt32LE(entry.key2 ?? 0, record + 0x1c);
		offset += stored.length;
	}
	return archive;
}

describe("C's ware ARC2 resource archive", () => {
	it("reads records and reverses the key chain", async () => {
		const first = Buffer.from("first payload!");
		const second = Buffer.from("second");
		await expectArchive({
			format: arc2Format,
			archive: buildArc2([
				{ name: "data/one.bin", content: first, key1: 0x1234, key2: 0x5678 },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("keeps only the first record of a repeated name", async () => {
		const first = Buffer.from("kept");
		const second = Buffer.from("dropped");
		await expectArchive({
			format: arc2Format,
			archive: buildArc2([
				{ name: "same.bin", content: first },
				{ name: "same.bin", content: second },
			]),
			sourcePath: "sample.arc",
			entries: [{ path: "same.bin", size: first.length, content: first }],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects an index beyond the file", async () => {
		const archive = buildArc2([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x1000, INDEX_OFFSET_OFFSET);
		await expectArchive({
			format: arc2Format,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
