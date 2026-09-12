import { encodeCp932 } from "@garbro-mcp/core";
import { antiqueDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAntique(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x14;
	const indexSize = entries.length * 0x10;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const dataOffset = indexOffset + indexSize + names.length;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ACHV", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x0c);
	archive.writeUInt32LE(names.length, 0x10);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x10;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	names.copy(archive, indexOffset + indexSize);
	return archive;
}

describe("An*tique ACHV archive", () => {
	it("reads a separate name section after the index", async () => {
		await expectArchive({
			format: antiqueDatFormat,
			archive: buildAntique([
				{ name: "cg\\a.g", content: Buffer.from("aaa") },
				{ name: "cg\\b.g", content: Buffer.from("bb") },
			]),
			entries: [
				{ path: "cg/a.g", size: 3, content: Buffer.from("aaa") },
				{ path: "cg/b.g", size: 2, content: Buffer.from("bb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
