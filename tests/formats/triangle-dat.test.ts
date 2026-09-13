import { encodeCp932 } from "@garbro-mcp/core";
import { triangleDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildTriangleDat(
	entries: { name: string; content: Buffer }[],
): Buffer {
	const recordSize = 0x11;
	// `count` counts the records, one of which is a name-only sentinel.
	const count = entries.length + 1;
	const firstOffset = 4 + count * recordSize;
	const total =
		firstOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(count, 0);
	archive.writeUInt32LE(firstOffset, 4);
	let offset = firstOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 8 + id * recordSize;
		encodeCp932(entry.name).copy(archive, record);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
		// The current record's tail holds the next data offset.
		archive.writeUInt32LE(offset, record + 0x0d);
	}
	// The final (name-only) record closes the index.
	encodeCp932("end").copy(archive, 8 + entries.length * recordSize);
	return archive;
}

describe("Triangle DAT archive", () => {
	it("reads 0x11-byte records with an implicit final size", async () => {
		await expectArchive({
			format: triangleDatFormat,
			archive: buildTriangleDat([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
