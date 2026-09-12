import { encodeCp932 } from "@garbro-mcp/core";
import { pfdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPfd(
	entries: { name: string; ext: string; content: Buffer }[],
): Buffer {
	const indexOffset = 4;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		encodeCp932(entry.ext).copy(archive, record + 0x15);
		archive.writeUInt32LE(offset, record + 0x18);
		archive.writeUInt32LE(entry.content.length, record + 0x1c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Artel PFD archive", () => {
	it("reads a separate extension field and index-following offsets", async () => {
		await expectArchive({
			format: pfdFormat,
			archive: buildPfd([
				{ name: "graphic", ext: "grd", content: Buffer.from("aa") },
				{ name: "script.scn", ext: "", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "graphic.grd", size: 2, content: Buffer.from("aa") },
				{ path: "script.scn", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
