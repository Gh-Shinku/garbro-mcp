import { encodeCp932 } from "@garbro-mcp/core";
import { tanakaArc0Format, tanakaWvxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildWvx(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("WVX0", 0, "ascii");
	archive.writeUInt32LE(total, 4);
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x20;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x1c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

function buildArc0(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x20;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ARC0", 0, "ascii");
	archive.writeUInt32LE(total, 4);
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x20;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 0x0c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Tanaka WVX audio archive", () => {
	it("derives sizes from the next record offset", async () => {
		await expectArchive({
			format: tanakaWvxFormat,
			archive: buildWvx([
				{ name: "bgm01", content: Buffer.from("one") },
				{ name: "bgm02", content: Buffer.from("twoo") },
			]),
			entries: [
				{ path: "bgm01", size: 3, content: Buffer.from("one") },
				{ path: "bgm02", size: 4, content: Buffer.from("twoo") },
			],
			metadata: { entryCount: 2 },
		});
	});
});

describe("Tanaka ARC0 archive", () => {
	it("reads explicit offset and size records", async () => {
		await expectArchive({
			format: tanakaArc0Format,
			archive: buildArc0([
				{ name: "a.txt", content: Buffer.from("aa") },
				{ name: "dir\\b.bin", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.txt", size: 2, content: Buffer.from("aa") },
				{ path: "dir/b.bin", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
