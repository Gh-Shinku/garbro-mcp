import { encodeCp932 } from "@garbro-mcp/core";
import { ukFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildUk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x18;
	const dataOffset = 4 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("UK", 0, "ascii");
	archive.writeUInt16LE(entries.length, 2);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 4 + index * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("For/Ucom UK archive", () => {
	it("reads a 16-bit count and absolute offsets", async () => {
		await expectArchive({
			format: ukFormat,
			archive: buildUk([
				{ name: "A.BIN", content: Buffer.from("first") },
				{ name: "B.BIN", content: Buffer.from("second") },
			]),
			entries: [
				{ path: "A.BIN", size: 5, content: Buffer.from("first") },
				{ path: "B.BIN", size: 6, content: Buffer.from("second") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
