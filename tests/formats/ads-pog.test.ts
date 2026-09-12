import { encodeCp932 } from "@garbro-mcp/core";
import { pogFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPog(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const offsetsSize = (entries.length + 1) * 4;
	const namesOffset = indexOffset + offsetsSize;
	const nameRecords = entries.map((entry, index) => {
		const name = encodeCp932(entry.name);
		const length = 4 + name.length + 1;
		const record = Buffer.alloc(4 + length);
		record.writeInt32LE(length, 0);
		record.writeInt32LE(index, 4);
		name.copy(record, 8);
		return record;
	});
	const names = Buffer.concat([Buffer.alloc(4), ...nameRecords]);
	const dataOffset = namesOffset + names.length;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("POG\0", 0, "binary");
	archive.writeUInt32LE(namesOffset, 4);
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(offset, indexOffset + id * 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	archive.writeUInt32LE(offset, indexOffset + entries.length * 4);
	names.copy(archive, namesOffset);
	return archive;
}

describe("ads POG audio archive", () => {
	it("assigns names from the trailing name table", async () => {
		await expectArchive({
			format: pogFormat,
			archive: buildPog([
				{ name: "bgm01.ogg", content: Buffer.from("aa") },
				{ name: "bgm02.ogg", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "bgm01.ogg", size: 2, content: Buffer.from("aa") },
				{ path: "bgm02.ogg", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
