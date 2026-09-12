import { encodeCp932 } from "@garbro-mcp/core";
import { clsFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildCls(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x40;
	const indexSize = entries.length * 0x40;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("CLS_FILELINK", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x10);
	archive.writeUInt32LE(indexOffset, 0x18);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x40;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x2c);
		archive.writeUInt32LE(entry.content.length, record + 0x30);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Lambda CLS archive", () => {
	it("reads a pointed-to 0x40-byte index", async () => {
		await expectArchive({
			format: clsFormat,
			archive: buildCls([
				{ name: "a.dat", content: Buffer.from("aa") },
				{ name: "dir\\b.dat", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.dat", size: 2, content: Buffer.from("aa") },
				{ path: "dir/b.dat", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
