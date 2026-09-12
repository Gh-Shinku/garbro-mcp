import { encodeCp932 } from "@garbro-mcp/core";
import { mifFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildMif(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x18;
	const dataOffset = 8 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("MIF\0", 0, "binary");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 8 + index * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("BasiL MIF archive", () => {
	it("reads absolute offsets", async () => {
		await expectArchive({
			format: mifFormat,
			archive: buildMif([
				{ name: "graf\\a.g", content: Buffer.from("aaa") },
				{ name: "sound.bgm", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "graf/a.g", size: 3, content: Buffer.from("aaa") },
				{ path: "sound.bgm", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
