import { shaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSha(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x50;
	const dataOffset = 0x0c + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("SHA_", 0, "ascii");
	archive.writeUInt32LE(0, 4);
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 0x0c + index * 0x50;
		const name = Buffer.from(entry.name, "utf8");
		archive.writeUInt8(name.length, record);
		name.copy(archive, record + 1);
		archive.writeUInt32LE(offset, record + 0x40);
		archive.writeUInt32LE(entry.content.length, record + 0x44);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("MG SHA archive", () => {
	it("reads length-prefixed UTF-8 names", async () => {
		await expectArchive({
			format: shaFormat,
			archive: buildSha([
				{ name: "script\\a.ks", content: Buffer.from("aa") },
				{ name: "画像.bmp", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "script/a.ks", size: 2, content: Buffer.from("aa") },
				{ path: "画像.bmp", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
