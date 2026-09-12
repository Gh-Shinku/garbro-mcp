import { nscFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildNsc(contents: Buffer[]): Buffer {
	const headerSize = 8;
	const offsetsSize = contents.length * 4;
	const dataOffset = headerSize + offsetsSize;
	const total = dataOffset + contents.reduce((sum, c) => sum + c.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("NSCF", 0, "ascii");
	archive.writeUInt32LE(dataOffset, 4);
	let offset = dataOffset;
	for (const [id, content] of contents.entries()) {
		content.copy(archive, offset);
		offset += content.length;
		archive.writeUInt32LE(offset, headerSize + id * 4);
	}
	return archive;
}

describe("Nekotaro NSC archive", () => {
	it("walks a monotonic offset table with derived sizes", async () => {
		await expectArchive({
			format: nscFormat,
			archive: buildNsc([Buffer.from("aaa"), Buffer.from("bb")]),
			sourcePath: "data.nsc",
			entries: [
				{ path: "data#0000", size: 3, content: Buffer.from("aaa") },
				{ path: "data#0001", size: 2, content: Buffer.from("bb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
