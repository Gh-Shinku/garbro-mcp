import { encodeCp932 } from "@garbro-mcp/core";
import { mpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildMpk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x100;
	const dataOffset = 0x48 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("MPK\0", 0, "binary");
	archive.writeUInt32LE(0, 4);
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 0x48 + index * 0x100;
		archive.writeBigUInt64LE(BigInt(offset), record);
		archive.writeUInt32LE(entry.content.length, record + 8);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		encodeCp932(entry.name).copy(archive, record + 0x18);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("MAGES MPK archive", () => {
	it("reads 64-bit offsets and records the unpacked size", async () => {
		await expectArchive({
			format: mpkFormat,
			archive: buildMpk([
				{ name: "data\\one.npk", content: Buffer.from("111") },
				{ name: "two.npk", content: Buffer.from("22") },
			]),
			entries: [
				{ path: "data/one.npk", size: 3, content: Buffer.from("111") },
				{ path: "two.npk", size: 2, content: Buffer.from("22") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
