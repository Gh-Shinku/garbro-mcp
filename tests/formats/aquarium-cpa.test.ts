import { encodeCp932 } from "@garbro-mcp/core";
import { cpaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildCpa(
	entries: { name: string; content: Buffer }[],
	inactive = 0,
): Buffer {
	const slots = entries.length + inactive;
	const dataOffset = 0x20 + slots * 0x20;
	const total =
		dataOffset + entries.reduce((sum, e) => sum + e.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("CPA\0", 0, "binary");
	archive.writeUInt32LE(dataOffset, 8);
	archive.writeInt32LE(slots, 12);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 0x20 + id * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Aquarium CPA archive", () => {
	it("skips zero-filled index slots", async () => {
		await expectArchive({
			format: cpaFormat,
			archive: buildCpa(
				[
					{ name: "a.bin", content: Buffer.from("aa") },
					{ name: "b.bin", content: Buffer.from("b") },
				],
				1,
			),
			entries: [
				{ path: "a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
