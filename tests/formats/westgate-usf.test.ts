import { encodeCp932 } from "@garbro-mcp/core";
import { usfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildUsf(entries: { name: string; content: Buffer }[]): Buffer {
	const recordSize = 0x10;
	const indexSize = entries.length * recordSize;
	const total =
		indexSize + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	let offset = indexSize;
	for (const [id, entry] of entries.entries()) {
		const record = id * recordSize;
		encodeCp932(entry.name).copy(archive, record);
		// Record `id`'s tail holds the data offset of entry `id`.
		archive.writeUInt32LE(offset, record + 0x0c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("West Gate USF archive", () => {
	it("reads names from the record table and derives sizes", async () => {
		await expectArchive({
			format: usfFormat,
			archive: buildUsf([
				{ name: "cg01", content: Buffer.from("aa") },
				{ name: "cg02", content: Buffer.from("bbb") },
			]),
			sourcePath: "data.usf",
			entries: [
				{ path: "cg01", size: 2, content: Buffer.from("aa") },
				{ path: "cg02", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
