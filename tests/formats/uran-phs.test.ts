import { encodeCp932 } from "@garbro-mcp/core";
import { phsFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPhs(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x50;
	const indexSize = entries.length * 0x14;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("KPHS", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x0c);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x14;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x0c);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("KuonAdv PHS archive", () => {
	it("uses a base-relative 0x14 index", async () => {
		await expectArchive({
			format: phsFormat,
			archive: buildPhs([{ name: "x.bin", content: Buffer.from("xyz") }]),
			entries: [{ path: "x.bin", size: 3, content: Buffer.from("xyz") }],
			metadata: { entryCount: 1 },
		});
	});
});
