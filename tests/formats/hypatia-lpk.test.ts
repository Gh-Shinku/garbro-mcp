import { encodeCp932 } from "@garbro-mcp/core";
import { lpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildLpk(entries: { name: string; content: Buffer }[]): Buffer {
	const baseOffset = 0x2800;
	const dataOffset = baseOffset;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	for (const [id, entry] of entries.entries()) {
		encodeCp932(entry.name).copy(archive, id * 0x10);
	}
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		archive.writeUInt32LE(offset - baseOffset, 0x2000 + id * 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	archive.writeUInt32LE(offset - baseOffset, 0x2000 + entries.length * 4);
	return archive;
}

describe("Kogado LPK archive", () => {
	it("reads a fixed name area and an offset table at 0x2000", async () => {
		await expectArchive({
			format: lpkFormat,
			archive: buildLpk([
				{ name: "CG01", content: Buffer.from("aa") },
				{ name: "CG02", content: Buffer.from("bbb") },
			]),
			sourcePath: "data.lpk",
			entries: [
				{ path: "CG01", size: 2, content: Buffer.from("aa") },
				{ path: "CG02", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
