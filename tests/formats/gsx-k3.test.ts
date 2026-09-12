import { encodeCp932 } from "@garbro-mcp/core";
import { k3Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildK3(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 6;
	const indexSize = entries.length * 0x40;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("K3", 0, "ascii");
	archive.writeInt32LE(entries.length, 2);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x40;
		archive.writeUInt32LE(offset - dataOffset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 0x20);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Toyo GSX K3 archive", () => {
	it("reads a 16-bit-aligned header and 0x40-byte records", async () => {
		await expectArchive({
			format: k3Format,
			archive: buildK3([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "dir\\b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "dir/b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
