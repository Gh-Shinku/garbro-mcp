import { encodeCp932 } from "@garbro-mcp/core";
import { dsvFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildDsv(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = (entries.length + 1) * 0x10;
	const dataOffset = indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = id * 0x10;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x0c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	// The terminating record has a zero size field.
	return archive;
}

describe("Desire DSV archive", () => {
	it("walks the index until a zero byte and checks the terminator", async () => {
		await expectArchive({
			format: dsvFormat,
			archive: buildDsv([
				{ name: "file1.g", content: Buffer.from("aa") },
				{ name: "file2.g", content: Buffer.from("bbb") },
			]),
			sourcePath: "data.000",
			entries: [
				{ path: "file1.g", size: 2, content: Buffer.from("aa") },
				{ path: "file2.g", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
