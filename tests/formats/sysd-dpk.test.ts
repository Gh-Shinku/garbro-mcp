import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { dpkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

function buildDpk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x14;
	const dataOffset = 8 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("PA", 0, "ascii");
	archive.writeUInt16LE(entries.length, 2);
	archive.writeUInt32LE(total, 4);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 8 + index * 0x14;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x10);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("SYSD DPK archive", () => {
	it("reads a sequential index", async () => {
		await expectArchive({
			format: dpkFormat,
			archive: buildDpk([
				{ name: "bg.bmp", content: Buffer.from("bitmap") },
				{ name: "音声\\se.wav", content: Buffer.from("wave") },
			]),
			entries: [
				{ path: "bg.bmp", size: 6, content: Buffer.from("bitmap") },
				{ path: "音声/se.wav", size: 4, content: Buffer.from("wave") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a declared size that differs from the file", async () => {
		const archive = buildDpk([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.writeUInt32LE(archive.length + 4, 4);
		expect(await dpkFormat.detect(new BufferByteSource(archive), "a.pak")).toBe(
			false,
		);
	});
});
