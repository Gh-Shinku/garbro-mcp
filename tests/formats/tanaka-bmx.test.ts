import { encodeCp932 } from "@garbro-mcp/core";
import { bmxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildBmx(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(total, 0);
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x1c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Tanaka BMX archive", () => {
	it("derives sizes backwards from the end of file", async () => {
		await expectArchive({
			format: bmxFormat,
			archive: buildBmx([
				{ name: "cg\\a.bc", content: Buffer.from("aa") },
				{ name: "b.bc", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "cg/a.bc", size: 2, content: Buffer.from("aa") },
				{ path: "b.bc", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
