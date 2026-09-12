import { encodeCp932 } from "@garbro-mcp/core";
import { leafPxFormat, leafTexFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildLeafTex(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x20;
	const indexSize = entries.length * 0x28;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("TEX PACK0.02", 0, "ascii");
	archive.writeInt32LE(entries.length, 12);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x28;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

function buildLeafPx(frames: Buffer[]): Buffer {
	const indexOffset = 0x20;
	const dataOffset = indexOffset + frames.length * 4;
	const total =
		dataOffset + frames.reduce((sum, frame) => sum + frame.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(frames.length, 0);
	archive.writeUInt16LE(0x80, 0x10);
	archive.write("Leaf", 0x14, "ascii");
	let offset = dataOffset;
	for (const [index, frame] of frames.entries()) {
		archive.writeUInt32LE(offset - dataOffset, indexOffset + index * 4);
		frame.copy(archive, offset);
		offset += frame.length;
	}
	return archive;
}

describe("Leaf TEX archive", () => {
	it("reads a 0x28-strided index with base-relative offsets", async () => {
		await expectArchive({
			format: leafTexFormat,
			archive: buildLeafTex([
				{ name: "cg\\001", content: Buffer.from("aaa") },
				{ name: "cg\\002", content: Buffer.from("bb") },
			]),
			entries: [
				{ path: "cg/001", size: 3, content: Buffer.from("aaa") },
				{ path: "cg/002", size: 2, content: Buffer.from("bb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});

describe("Leaf PX multi-frame image", () => {
	it("derives frame sizes from neighbouring offsets", async () => {
		await expectArchive({
			format: leafPxFormat,
			archive: buildLeafPx([Buffer.from("f1"), Buffer.from("f2f2")]),
			sourcePath: "cg.px",
			entries: [
				{ path: "cg#0000", size: 2, content: Buffer.from("f1") },
				{ path: "cg#0001", size: 4, content: Buffer.from("f2f2") },
			],
			metadata: { frameCount: 2 },
		});
	});
});
