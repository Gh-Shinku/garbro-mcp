import { encodeCp932 } from "@garbro-mcp/core";
import { silkyArcFormat, silkyMfgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSilkyArc(entries: { name: string; content: Buffer }[]): Buffer {
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
		archive.writeUInt32LE(offset, record + 0x20);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

function buildSilkyMfg(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 8;
	const indexSize = entries.length * 0x14;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ALPF", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x14;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Silky's ARC archive", () => {
	it("rejects duplicate offsets and reads the index", async () => {
		await expectArchive({
			format: silkyArcFormat,
			archive: buildSilkyArc([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			sourcePath: "data.arc",
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});

describe("Silky's MFG archive", () => {
	it("derives sizes from adjacent name records", async () => {
		await expectArchive({
			format: silkyMfgFormat,
			archive: buildSilkyMfg([
				{ name: "cg01", content: Buffer.from("a") },
				{ name: "cg02", content: Buffer.from("bb") },
			]),
			entries: [
				{ path: "cg01", size: 1, content: Buffer.from("a") },
				{ path: "cg02", size: 2, content: Buffer.from("bb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
