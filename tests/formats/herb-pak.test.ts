import { encodeCp932 } from "@garbro-mcp/core";
import { herbPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildHerb(entries: { name: string; content: Buffer }[]): Buffer {
	const baseOffset = 0x20000;
	const indexOffset = 0x80;
	const total =
		baseOffset + entries.reduce((sum, e) => sum + e.content.length, 0);
	const archive = Buffer.alloc(total, 0);
	archive.write("..\0", 0x40, "binary");
	let offset = baseOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x40;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - baseOffset, record + 0x30);
		archive.writeUInt32LE(entry.content.length, record + 0x38);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Herb Soft PAK archive", () => {
	it("reads a fixed 0x80 index area with a 0x20000 data base", async () => {
		await expectArchive({
			format: herbPakFormat,
			archive: buildHerb([
				{ name: "cg.grp", content: Buffer.from("aa") },
				{ name: "sound.wav", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "cg.grp", size: 2, content: Buffer.from("aa") },
				{ path: "sound.wav", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
