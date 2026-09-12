import { encodeCp932 } from "@garbro-mcp/core";
import { abelFpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAbelFpk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 12;
	const indexSize = entries.length * 8;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const namesOffset = indexOffset + indexSize;
	const dataOffset = namesOffset + names.length;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("FPK\0", 0, "binary");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(names.length, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	names.copy(archive, namesOffset);
	return archive;
}

describe("Abel FPK archive", () => {
	it("reads a separate name section after the index", async () => {
		await expectArchive({
			format: abelFpkFormat,
			archive: buildAbelFpk([
				{ name: "dir\\a.cbf", content: Buffer.from("aa") },
				{ name: "b.wav", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "dir/a.cbf", size: 2, content: Buffer.from("aa") },
				{ path: "b.wav", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
