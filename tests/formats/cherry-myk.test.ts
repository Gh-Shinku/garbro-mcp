import { encodeCp932 } from "@garbro-mcp/core";
import { mykFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildMyk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x40;
	const indexSize = entries.length * 0x10;
	const total =
		indexOffset +
		indexSize +
		entries.reduce((sum, e) => sum + e.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("MYK0", 0, "ascii");
	archive.writeUInt16LE(0x1a30, 4);
	archive.writeUInt16LE(entries.length, 8);
	archive.writeUInt32LE(indexOffset, 0x0a);
	let offset = 0x10;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x10;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x0c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Cherry MYK archive", () => {
	it("validates the version marker and reads 16-bit counts", async () => {
		await expectArchive({
			format: mykFormat,
			archive: buildMyk([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
