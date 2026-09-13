import { encodeCp932 } from "@garbro-mcp/core";
import { glnkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x12;

interface GlnkEntry {
	name: string;
	content: Buffer;
}

function buildGlnk(entries: readonly GlnkEntry[], version = 0x6e): Buffer {
	const recordTail = version >= 0x6e ? 12 : 8;
	const indexSize = entries.reduce(
		(sum, entry) => sum + 1 + encodeCp932(entry.name).length + recordTail,
		0,
	);
	const indexOffset = HEADER_SIZE;
	const dataOffset = indexOffset + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("GLNK", 0, "ascii");
	archive.writeUInt16LE(version, 4);
	archive.writeInt32LE(entries.length, 6);
	archive.writeUInt32LE(indexOffset, 0x0a);
	archive.writeInt32LE(indexSize, 0x0e);
	let position = indexOffset;
	let offset = dataOffset;
	for (const entry of entries) {
		const name = encodeCp932(entry.name);
		archive.writeUInt8(name.length, position);
		name.copy(archive, position + 1);
		position += 1 + name.length;
		archive.writeUInt32LE(offset, position);
		archive.writeUInt32LE(entry.content.length, position + 4);
		position += recordTail;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Studio Miris GLNK archive", () => {
	it("walks a long-record index", async () => {
		await expectArchive({
			format: glnkFormat,
			archive: buildGlnk([
				{ name: "script.ets", content: Buffer.from("script") },
				{ name: "image/背景.glk", content: Buffer.from("bitmap!") },
			]),
			entries: [
				{ path: "script.ets", size: 6, content: Buffer.from("script") },
				{ path: "image/背景.glk", size: 7, content: Buffer.from("bitmap!") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("walks a short-record index for older versions", async () => {
		const content = Buffer.from("legacy");
		await expectArchive({
			format: glnkFormat,
			archive: buildGlnk([{ name: "old.dat", content }], 0x66),
			entries: [{ path: "old.dat", size: content.length, content }],
		});
	});

	it("rejects an index that exceeds the file", async () => {
		const archive = buildGlnk([{ name: "a.dat", content: Buffer.from("a") }]);
		archive.writeInt32LE(0x1000, 0x0e);
		await expectArchive({
			format: glnkFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
