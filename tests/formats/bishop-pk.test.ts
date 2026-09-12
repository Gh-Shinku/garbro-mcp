import { encodeCp932 } from "@garbro-mcp/core";
import { bishopPkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildBishopPk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x230;
	const dataOffset = 0x0c + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(0x4b508e8c, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(0, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 0x0c + index * 0x230;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x204);
		archive.writeUInt32LE(entry.content.length, record + 0x208);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Bishop PK archive", () => {
	it("reads 0x230-byte records with 0x200-byte names", async () => {
		await expectArchive({
			format: bishopPkFormat,
			archive: buildBishopPk([
				{ name: "cg\\001.bmp", content: Buffer.from("cg") },
				{ name: "script.ks", content: Buffer.from("scenario") },
			]),
			entries: [
				{ path: "cg/001.bmp", size: 2, content: Buffer.from("cg") },
				{ path: "script.ks", size: 8, content: Buffer.from("scenario") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
