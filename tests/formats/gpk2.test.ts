import { encodeCp932 } from "@garbro-mcp/core";
import { gpk2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildGpk2(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x88;
	const dataOffset = indexOffset + 4 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("GPK2", 0, "ascii");
	archive.writeUInt32LE(indexOffset, 4);
	archive.writeInt32LE(entries.length, indexOffset);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + 4 + index * 0x88;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 8);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("GPK2 archive", () => {
	it("reads a pointed-to 0x88-strided index", async () => {
		await expectArchive({
			format: gpk2Format,
			archive: buildGpk2([
				{ name: "cg\\a.g", content: Buffer.from("aa") },
				{ name: "cg\\b.g", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "cg/a.g", size: 2, content: Buffer.from("aa") },
				{ path: "cg/b.g", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
