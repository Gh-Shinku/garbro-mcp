import { encodeCp932 } from "@garbro-mcp/core";
import { pkdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPkd(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x2c;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(1, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(dataOffset, 0x0c);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x2c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Zone PKD archive", () => {
	it("reads the leading marker and base-relative offsets", async () => {
		await expectArchive({
			format: pkdFormat,
			archive: buildPkd([
				{ name: "cg\\a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			sourcePath: "data.pkd",
			entries: [
				{ path: "cg/a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
