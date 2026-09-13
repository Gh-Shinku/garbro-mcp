import { encodeCp932 } from "@garbro-mcp/core";
import { xarcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;
const NAME_OFFSET = 0x20;
const DATA_PREFIX = 0x22;

function rotateName(name: string): Buffer {
	const bytes = encodeCp932(name);
	for (let position = 0; position < bytes.length; position += 1) {
		const value = bytes[position] ?? 0;
		bytes[position] = ((value << 4) | (value >> 4)) & 0xff;
	}
	return bytes;
}

function buildXarc(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const count = entries.length;
	const indexSize = count * 4;
	const firstOffset = INDEX_OFFSET + indexSize + 2;
	const records = entries.map((entry) => {
		const name = rotateName(entry.name);
		const record = Buffer.alloc(NAME_OFFSET + name.length);
		record.write("DATA", 0, "ascii");
		record.writeUInt16LE(name.length, 0x18);
		record.writeUInt32LE(entry.content.length, 0x1c);
		name.copy(record, NAME_OFFSET);
		return Buffer.concat([record, Buffer.alloc(2), entry.content]);
	});
	const header = Buffer.alloc(firstOffset);
	header.write("XARC", 0, "ascii");
	header.writeInt32LE(count, 4);
	let offset = firstOffset;
	for (const [id, record] of records.entries()) {
		header.writeUInt32LE(offset, INDEX_OFFSET + id * 4);
		offset += record.length;
	}
	return Buffer.concat([header, ...records]);
}

describe("Xuse XARC archive", () => {
	it("reads nibble-rotated names and data offsets", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second");
		await expectArchive({
			format: xarcFormat,
			archive: buildXarc([
				{ name: "data/one.bin", content: first },
				{ name: "音声.bin", content: second },
			]),
			sourcePath: "sample.arc",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "音声.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a mismatched first offset", async () => {
		const archive = buildXarc([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.writeUInt32LE(0x100, INDEX_OFFSET);
		await expectArchive({
			format: xarcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a record without the DATA marker", async () => {
		const archive = buildXarc([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.write("DATE", INDEX_OFFSET + 4, "ascii");
		await expectArchive({
			format: xarcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
