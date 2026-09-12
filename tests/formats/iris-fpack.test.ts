import { encodeCp932 } from "@garbro-mcp/core";
import { irisFpackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildIrisFpack(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x18;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("FPACK\0", 0, "binary");
	archive.writeUInt16LE(entries.length, 6);
	archive.writeUInt32LE(total, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Iris FPACK archive", () => {
	it("validates the total size and reads 16-bit counts", async () => {
		await expectArchive({
			format: irisFpackFormat,
			archive: buildIrisFpack([
				{ name: "a.bin", content: Buffer.from("aa") },
				{ name: "b.bin", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
