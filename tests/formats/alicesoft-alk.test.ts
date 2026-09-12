import { alkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAlk(entries: { content: Buffer }[]): Buffer {
	const indexOffset = 8;
	const indexSize = entries.length * 8;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ALK0", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("AliceSoft ALK archive", () => {
	it("skips zero-sized records and names entries by index", async () => {
		await expectArchive({
			format: alkFormat,
			archive: buildAlk([
				{ content: Buffer.from("aa") },
				{ content: Buffer.from("") },
				{ content: Buffer.from("bbb") },
			]),
			sourcePath: "data.alk",
			entries: [
				{ path: "data#0000", size: 2, content: Buffer.from("aa") },
				{ path: "data#0002", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
