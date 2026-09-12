import { capybaraDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildCapybara(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x18;
	const indexSize = entries.length * 8;
	const namesOffset = indexOffset + indexSize;
	const names = Buffer.from(
		`${entries.map((entry) => entry.name).join("\r\n")}\r\n:END\r\n`,
		"binary",
	);
	const dataOffset = namesOffset + names.length;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("CAPYBARA DAT 001", 0, "ascii");
	archive.writeUInt32LE(namesOffset, 0x10);
	archive.writeUInt32LE(names.length, 0x14);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(offset, indexOffset + id * 8);
		archive.writeUInt32LE(entry.content.length, indexOffset + id * 8 + 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	names.copy(archive, namesOffset);
	return archive;
}

describe("CAPYBARA DAT archive", () => {
	it("reads a name list terminated by :END", async () => {
		await expectArchive({
			format: capybaraDatFormat,
			archive: buildCapybara([
				{ name: "cg\\a.bmp", content: Buffer.from("aa") },
				{ name: "b.bmp", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "cg/a.bmp", size: 2, content: Buffer.from("aa") },
				{ path: "b.bmp", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
