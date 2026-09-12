import { encodeCp932 } from "@garbro-mcp/core";
import { nafFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildNaf(
	entries: { name: string; ext: string; content: Buffer }[],
): Buffer {
	const indexOffset = 0x40;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("1.BROWNIE", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x30);
	archive.writeUInt32LE(indexOffset, 0x34);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		encodeCp932(entry.ext).copy(archive, record + 0x10);
		archive.writeUInt32LE(offset, record + 0x14);
		archive.writeUInt32LE(entry.content.length, record + 0x18);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Brownie NAF archive", () => {
	it("appends the separate extension field", async () => {
		await expectArchive({
			format: nafFormat,
			archive: buildNaf([
				{ name: "cg01", ext: "bmp", content: Buffer.from("aa") },
				{ name: "scenario.ks", ext: "txt", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "cg01.bmp", size: 2, content: Buffer.from("aa") },
				{ path: "scenario.txt", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
