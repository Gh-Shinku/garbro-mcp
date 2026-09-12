import { encodeCp932 } from "@garbro-mcp/core";
import { clioPacFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildClio(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 4;
	const indexSize = entries.length * 0x28;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x28;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x20);
		archive.writeUInt32LE(offset, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Clio PAC archive", () => {
	it("reads a 0x28-strided index with size before offset", async () => {
		await expectArchive({
			format: clioPacFormat,
			archive: buildClio([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			sourcePath: "data.pac",
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
