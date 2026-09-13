import { paqFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPaq(contents: Buffer[]): Buffer {
	const dataOffset = 4 + contents.length * 8;
	const total = dataOffset + contents.reduce((sum, c) => sum + c.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(contents.length, 0);
	let offset = dataOffset;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(0, 4 + id * 8);
		archive.writeUInt32LE(content.length, 4 + id * 8 + 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	return archive;
}

describe("Force PAQ archive", () => {
	it("reads 8-byte records whose size field precedes the payloads", async () => {
		await expectArchive({
			format: paqFormat,
			archive: buildPaq([Buffer.from("aa"), Buffer.from("bbb")]),
			sourcePath: "data.paq",
			entries: [
				{ path: "data#0000", size: 2, content: Buffer.from("aa") },
				{ path: "data#0001", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
