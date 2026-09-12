import { encodeCp932 } from "@garbro-mcp/core";
import { p8Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildP8(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x1c;
	const dataOffset = 4 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 4 + index * 0x1c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		archive.writeUInt32LE(offset, record + 0x18);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("TinkerBell P8 archive", () => {
	it("reads 0x1c-strided records and skips empty names", async () => {
		await expectArchive({
			format: p8Format,
			archive: buildP8([
				{ name: "one.bmp", content: Buffer.from("1") },
				{ name: "", content: Buffer.from("") },
				{ name: "dir\\two.bmp", content: Buffer.from("22") },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one.bmp", size: 1, content: Buffer.from("1") },
				{ path: "dir/two.bmp", size: 2, content: Buffer.from("22") },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("does not detect archives without the .pak extension", async () => {
		await expectArchive({
			format: p8Format,
			archive: buildP8([{ name: "one.bmp", content: Buffer.from("1") }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
