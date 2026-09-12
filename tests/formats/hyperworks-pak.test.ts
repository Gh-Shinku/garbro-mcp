import { encodeCp932 } from "@garbro-mcp/core";
import { hyperworksPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildHyperworks(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 8;
	const recordSize = 0x18;
	const indexSize = entries.length * recordSize;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("PACK", 0, "ascii");
	archive.writeInt32LE(indexSize, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * recordSize;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		const name = encodeCp932(entry.name);
		archive.writeUInt8(name.length, record + 8);
		name.copy(archive, record + 9);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("HyperWorks PACK archive", () => {
	it("reads a declared index size and byte-length names", async () => {
		await expectArchive({
			format: hyperworksPakFormat,
			archive: buildHyperworks([
				{ name: "ONE.DAT", content: Buffer.from("111") },
				{ name: "TWO.DAT", content: Buffer.from("22") },
			]),
			entries: [
				{ path: "ONE.DAT", size: 3, content: Buffer.from("111") },
				{ path: "TWO.DAT", size: 2, content: Buffer.from("22") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
