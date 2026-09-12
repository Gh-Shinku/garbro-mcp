import { encodeCp932 } from "@garbro-mcp/core";
import { ffaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildFfa(
	head: string,
	entries: { name: string; content: Buffer }[],
): Buffer {
	const recordSize = 0x18;
	const indexSize = entries.length * recordSize;
	const dataOffset = 0x40;
	const dataSize = entries.reduce(
		(sum, entry) => sum + entry.content.length,
		0,
	);
	const indexOffset = dataOffset + dataSize;
	const total = indexOffset + indexSize + 0x14;
	const archive = Buffer.alloc(total);
	archive.write(head, 0, "ascii");
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		entry.content.copy(archive, offset);
		const record = indexOffset + id * recordSize;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		offset += entry.content.length;
	}
	// The last 0x14 bytes store the index size, the entry count, and padding.
	archive.writeUInt32LE(indexSize, total - 12);
	archive.writeInt32LE(entries.length, total - 8);
	return archive;
}

describe("FFA System ARC archive", () => {
	it("reads a trailing index pointer from the end of file", async () => {
		await expectArchive({
			format: ffaFormat,
			archive: buildFfa("M2TYPE_WAV", [
				{ name: "a.wav", content: Buffer.from("aa") },
				{ name: "b.wav", content: Buffer.from("b") },
			]),
			sourcePath: "data.arc",
			entries: [
				{ path: "a.wav", size: 2, content: Buffer.from("aa") },
				{ path: "b.wav", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
