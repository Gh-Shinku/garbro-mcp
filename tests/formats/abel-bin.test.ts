import { encodeCp932 } from "@garbro-mcp/core";
import { abelBinFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAbel(entries: { name: string; content: Buffer }[]): Buffer {
	const names = entries.map((entry) => encodeCp932(entry.name));
	const namesSize = names.reduce((sum, name) => sum + name.length + 1, 0);
	const recordsOffset = 0x18;
	const recordsSize = entries.length * 12;
	const indexSize = recordsOffset + recordsSize + namesSize;
	const dataOffset = indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(total, 0);
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(indexSize, 8);
	archive.writeUInt32LE(0, 0x0c);
	archive.writeUInt32LE(0, 0x10);
	archive.writeUInt32LE(recordsOffset, 0x14);
	let namePosition = recordsOffset + recordsSize;
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = recordsOffset + index * 12;
		const name = names[index] ?? Buffer.alloc(0);
		archive.writeInt32LE(namePosition, record);
		archive.writeUInt32LE(offset, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		name.copy(archive, namePosition);
		namePosition += name.length + 1;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Abel BIN archive", () => {
	it("reads a name table inside the index region", async () => {
		await expectArchive({
			format: abelBinFormat,
			archive: buildAbel([
				{ name: "\\dir\\a.bin", content: Buffer.from("aa") },
				{ name: "b.bin", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "dir/a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
