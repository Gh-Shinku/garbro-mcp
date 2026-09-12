import { palettePakFormat } from "@garbro-mcp/formats";
import { encodeCp932 } from "@garbro-mcp/core";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPalette(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x0c;
	const indexSize = entries.length * 0x28;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("FilePack", 0, "ascii");
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x28;
		const name = encodeCp932(entry.name);
		for (let index = 0; index < 0x20; index += 1) {
			archive[record + index] = (name[index] ?? 0) ^ 0xff;
		}
		archive.writeUInt32LE(entry.content.length, record + 0x20);
		archive.writeUInt32LE(offset, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Palette FilePack archive", () => {
	it("inverts the XOR-0xFF name field", async () => {
		await expectArchive({
			format: palettePakFormat,
			archive: buildPalette([
				{ name: "cg01.pga", content: Buffer.from("aa") },
				{ name: "bgm.ogg", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "cg01.pga", size: 2, content: Buffer.from("aa") },
				{ path: "bgm.ogg", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
