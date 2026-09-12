import { encodeCp932 } from "@garbro-mcp/core";
import { unaDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildUna(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x20;
	const indexSize = entries.length * 0x30;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("UNA\0", 0, "binary");
	archive.write("001\0", 4, "binary");
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x30;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("MyHarvest UNA archive", () => {
	it("reads a 0x30-strided index", async () => {
		await expectArchive({
			format: unaDatFormat,
			archive: buildUna([
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
