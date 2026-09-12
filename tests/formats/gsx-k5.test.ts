import { k5Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

interface K5Entry {
	directory: string;
	name: string;
	content: Buffer;
}

function buildK5(entries: K5Entry[]): Buffer {
	const indexOffset = 0x40;
	const indexSize = entries.length * 0x100;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(0x0001354b, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(indexOffset, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x100;
		Buffer.from(entry.directory, "utf16le").copy(archive, record);
		Buffer.from(entry.name, "utf16le").copy(archive, record + 0x80);
		archive.writeUInt32LE(offset, record + 0xc8);
		archive.writeUInt32LE(entry.content.length, record + 0xcc);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("GSX K5 archive", () => {
	it("reads UTF-16 directory and file names", async () => {
		await expectArchive({
			format: k5Format,
			archive: buildK5([
				{ directory: "data", name: "a.bin", content: Buffer.from("aa") },
				{ directory: "", name: "b.bin", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "data/a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
