import { encodeCp932 } from "@garbro-mcp/core";
import { sdaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSda(entries: { name: string; content: Buffer }[]): Buffer {
	const dataOffset = 8 + entries.length * 0x1c;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("SA", 0, "ascii");
	archive.writeUInt32LE(dataOffset, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 8 + id * 0x1c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x14);
		archive.writeUInt32LE(entry.content.length, record + 0x18);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("MMFass SDA archive", () => {
	it("derives the count from the data offset", async () => {
		await expectArchive({
			format: sdaFormat,
			archive: buildSda([
				{ name: "a.bin", content: Buffer.from("aa") },
				{ name: "b.bin", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
