import { tailPkgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildTailPkg(contents: Buffer[]): Buffer {
	const indexOffset = 8;
	const indexSize = contents.length * 8;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + contents.reduce((sum, item) => sum + item.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("PKG ", 0, "ascii");
	archive.writeInt32LE(contents.length, 4);
	let offset = dataOffset;
	for (const [index, content] of contents.entries()) {
		const record = indexOffset + index * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(content.length, record + 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	return archive;
}

describe("Archive's PKG container", () => {
	it("names entries from the file name and reads absolute offsets", async () => {
		await expectArchive({
			format: tailPkgFormat,
			archive: buildTailPkg([Buffer.from("aa"), Buffer.from("b")]),
			sourcePath: "cg.pkg",
			entries: [
				{ path: "cg#0000", size: 2, content: Buffer.from("aa") },
				{ path: "cg#0001", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
