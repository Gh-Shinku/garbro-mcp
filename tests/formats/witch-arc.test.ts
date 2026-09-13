import { encodeCp932 } from "@garbro-mcp/core";
import { witchArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildWitchArc(entries: { name: string; content: Buffer }[]): Buffer {
	const dirTag = Buffer.from([0x44, 0x49, 0x52, 0x20, 0, 0, 0, 0]);
	const indexPath = 0x10;
	const indexSize = entries.reduce(
		(sum, entry) => sum + 0x28 + encodeCp932(entry.name).length,
		0,
	);
	const dataOffset = indexPath + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ARC ", 0, "ascii");
	archive.writeInt32LE(0, 4);
	let position = indexPath;
	let offset = dataOffset;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		const fixed = Buffer.alloc(0x28);
		dirTag.copy(fixed, 0);
		fixed.writeInt32LE(0, 8);
		fixed.writeInt32LE(name.length, 12);
		fixed.writeUInt32LE(entry.content.length, 0x20);
		fixed.writeUInt32LE(offset, 0x24);
		fixed.copy(archive, position);
		name.copy(archive, position + 0x28);
		entry.content.copy(archive, offset);
		position += 0x28 + name.length;
		offset += entry.content.length;
	}
	return archive;
}

describe("Witch ARC archive", () => {
	it("walks DIR-tagged records with variable-length names", async () => {
		await expectArchive({
			format: witchArcFormat,
			archive: buildWitchArc([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "dir\\b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "dir/b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
