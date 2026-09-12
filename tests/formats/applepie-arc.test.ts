import { encodeCp932 } from "@garbro-mcp/core";
import { applePieArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildApplePie(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x20;
	const indexSize = entries.length * 0x18;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(0x10435241, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(0, 8);
	archive.writeUInt32LE(indexOffset, 0x0c);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		archive.writeUInt32LE(offset, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Apple Pie ARC archive", () => {
	it("reads a pointed-to index with size before offset", async () => {
		await expectArchive({
			format: applePieArcFormat,
			archive: buildApplePie([
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
