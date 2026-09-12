import { aryFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAry(contents: Buffer[]): Buffer {
	const indexSize = contents.length * 4 + 8;
	const total = indexSize + contents.reduce((sum, c) => sum + c.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(contents.length, 0);
	let offset = indexSize;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(offset, 4 + id * 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	archive.writeUInt32LE(offset, indexSize - 4);
	return archive;
}

describe("Pearl ARY archive", () => {
	it("validates the first and sentinel offsets", async () => {
		await expectArchive({
			format: aryFormat,
			archive: buildAry([Buffer.from("aa"), Buffer.from("bbb")]),
			sourcePath: "data.ary",
			entries: [
				{ path: "data#0000", size: 2, content: Buffer.from("aa") },
				{ path: "data#0001", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
