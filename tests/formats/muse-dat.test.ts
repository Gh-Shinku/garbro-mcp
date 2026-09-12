import { encodeCp932 } from "@garbro-mcp/core";
import { museDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildMuse(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x16;
	const indexSize = entries.length * 0x10b;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("MUSE", 0, "ascii");
	archive.writeUInt16LE(entries.length, 0x10);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x10b;
		archive.writeUInt32LE(entry.content.length, record + 2);
		archive.writeUInt32LE(offset, record + 7);
		encodeCp932(entry.name).copy(archive, record + 0x0b);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Muse DAT archive", () => {
	it("reads an unusual 0x10b-strided index", async () => {
		await expectArchive({
			format: museDatFormat,
			archive: buildMuse([
				{ name: "dir\\a.bin", content: Buffer.from("aa") },
				{ name: "b.bin", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "dir/a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
