import { encodeCp932 } from "@garbro-mcp/core";
import { parsleyPacFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildParsleyPac(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x28;
	const dataOffset = 8 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("PAC0", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 8 + index * 0x28;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Software House Parsley PAC archive", () => {
	it("reads a 0x28-strided index", async () => {
		await expectArchive({
			format: parsleyPacFormat,
			archive: buildParsleyPac([
				{ name: "cg01.g", content: Buffer.from("g1") },
				{ name: "cg02.g", content: Buffer.from("g22") },
			]),
			entries: [
				{ path: "cg01.g", size: 2, content: Buffer.from("g1") },
				{ path: "cg02.g", size: 3, content: Buffer.from("g22") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
