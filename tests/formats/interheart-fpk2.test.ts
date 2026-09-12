import { encodeCp932 } from "@garbro-mcp/core";
import { fpk2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildFpk2(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x20;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("FPK 2.00", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x1c);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x20;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 8);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Interheart FPK 2.00 archive", () => {
	it("skips names that start with a slash", async () => {
		await expectArchive({
			format: fpk2Format,
			archive: buildFpk2([
				{ name: "a.bin", content: Buffer.from("aa") },
				{ name: "/skipped", content: Buffer.from("skip") },
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
