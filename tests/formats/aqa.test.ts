import { encodeCp932 } from "@garbro-mcp/core";
import { aqaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAqa(
	entries: { name: string; content: Buffer }[],
	keySeed = 0x12345678,
): Buffer {
	const indexOffset = 0x18;
	const indexSize = entries.length * 0x90;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("AQA ", 0, "ascii");
	archive.writeUInt32LE(keySeed, 8);
	archive.writeInt32LE(entries.length, 12);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x90;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x80);
		archive.writeUInt32LE(offset - dataOffset, record + 0x88);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	const key = (((101 * keySeed + 777) & 0xffff) + 1) & 0xffff;
	for (let position = indexOffset; position < dataOffset; position += 2) {
		archive[position] = (archive[position] ?? 0) ^ (key & 0xff);
		archive[position + 1] = (archive[position + 1] ?? 0) ^ (key >> 8);
	}
	return archive;
}

describe("AQA archive", () => {
	it("decrypts the 16-bit XOR-keystream index", async () => {
		await expectArchive({
			format: aqaFormat,
			archive: buildAqa([
				{ name: "cg\\a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "cg/a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
