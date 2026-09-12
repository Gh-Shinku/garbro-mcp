import { encodeCp932 } from "@garbro-mcp/core";
import { succubusArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildArc1(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x18;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ARC1", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(indexOffset, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		archive.writeUInt32LE(offset, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Succubus ARC1 archive", () => {
	it("reads a pointed-to 0x18-strided index", async () => {
		await expectArchive({
			format: succubusArcFormat,
			archive: buildArc1([
				{ name: "one.wav", content: Buffer.from("wavdata") },
				{ name: "two.wav", content: Buffer.from("wav") },
			]),
			entries: [
				{ path: "one.wav", size: 7, content: Buffer.from("wavdata") },
				{ path: "two.wav", size: 3, content: Buffer.from("wav") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
