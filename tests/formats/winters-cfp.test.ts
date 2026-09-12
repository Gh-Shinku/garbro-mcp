import { cfpFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildCfp(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x20;
	const indexSize = entries.length * 0x0c;
	const namesOffset = indexOffset + indexSize;
	const names = Buffer.from(
		`${entries.map((entry) => entry.name).join("\r\n")}\r\n`,
		"binary",
	);
	const dataOffset = namesOffset + names.length;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("CAPYBARA DAT 002", 0, "ascii");
	archive.writeUInt32LE(namesOffset, 0x14);
	archive.writeUInt32LE(names.length, 0x18);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x0c;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	names.copy(archive, namesOffset);
	return archive;
}

describe("Winters CFP archive", () => {
	it("reads line-based names after the fixed header", async () => {
		await expectArchive({
			format: cfpFormat,
			archive: buildCfp([
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
