import { encodeCp932 } from "@garbro-mcp/core";
import { circusPckFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPck(entries: { name: string; content: Buffer }[]): Buffer {
	const preamble = entries.length * 8;
	const indexSize = entries.length * 0x40;
	const dataOffset = 4 + preamble + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	archive.writeUInt32LE(dataOffset, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 4 + preamble + id * 0x40;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x38);
		archive.writeUInt32LE(entry.content.length, record + 0x3c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Circus PCK archive", () => {
	it("reads an index that follows an 8-byte-per-entry preamble", async () => {
		await expectArchive({
			format: circusPckFormat,
			archive: buildPck([
				{ name: "cg\\a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "cg/a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
