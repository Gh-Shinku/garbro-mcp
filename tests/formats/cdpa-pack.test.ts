import { encodeCp932 } from "@garbro-mcp/core";
import { cdpaPackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildCdpa(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 8;
	const indexSize = entries.length * 0x28;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("PACK", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x28;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x20);
		archive.writeUInt32LE(offset, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("CDPA PACK archive", () => {
	it("reads a 0x28-strided index with offsets after the table", async () => {
		await expectArchive({
			format: cdpaPackFormat,
			archive: buildCdpa([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "dir\\b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "dir/b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
