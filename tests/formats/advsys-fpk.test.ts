import { encodeCp932 } from "@garbro-mcp/core";
import { advSysFpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAdvSysFpk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("MFWY", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(dataOffset, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x18);
		archive.writeUInt32LE(offset, record + 0x1c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("AdvSys_T FPK archive", () => {
	it("reads a declared data offset and 0x20-byte records", async () => {
		await expectArchive({
			format: advSysFpkFormat,
			archive: buildAdvSysFpk([
				{ name: "a.bin", content: Buffer.from("aa") },
				{ name: "b.bin", content: Buffer.from("b") },
			]),
			sourcePath: "data.fpk",
			entries: [
				{ path: "a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
