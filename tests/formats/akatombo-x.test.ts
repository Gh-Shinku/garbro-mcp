import { akatomboXFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAkatombo(contents: Buffer[]): Buffer {
	const indexSize = contents.length * 4 + 6;
	const total = indexSize + contents.reduce((sum, c) => sum + c.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt16LE(contents.length, 0);
	let offset = indexSize;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(offset, 2 + id * 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	archive.writeUInt32LE(offset, indexSize - 4);
	return archive;
}

describe("Akatombo X archive", () => {
	it("reads a 16-bit count and derived sizes", async () => {
		await expectArchive({
			format: akatomboXFormat,
			archive: buildAkatombo([Buffer.from("aa"), Buffer.from("b")]),
			sourcePath: "data.x",
			entries: [
				{ path: "data#0000", size: 2, content: Buffer.from("aa") },
				{ path: "data#0001", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
