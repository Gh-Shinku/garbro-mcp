import { ccfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildCcf(contents: Buffer[]): Buffer {
	const baseOffset = 8 + contents.length * 4;
	const total =
		baseOffset + contents.reduce((sum, content) => sum + content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write('CCf"', 0, "ascii");
	archive.writeInt32LE(contents.length, 4);
	let offset = baseOffset;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(offset - baseOffset, 8 + id * 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	return archive;
}

describe("BlackRainbow CCF archive", () => {
	it("derives sizes from the offset table", async () => {
		await expectArchive({
			format: ccfFormat,
			archive: buildCcf([Buffer.from("aa"), Buffer.from("bbb")]),
			sourcePath: "bgm.pak",
			entries: [
				{ path: "bgm#0000", size: 2, content: Buffer.from("aa") },
				{ path: "bgm#0001", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
