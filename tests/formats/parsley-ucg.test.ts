import { encodeCp932 } from "@garbro-mcp/core";
import { ucgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 8;
const RECORD_SIZE = 0x18;

interface UcgEntry {
	name: string;
	content: Buffer;
}

function buildUcg(entries: readonly UcgEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * RECORD_SIZE;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt8(0x64, 0);
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x14);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("Software House Parsley UCG archive", () => {
	it("derives sizes from the record offsets", async () => {
		const first = Buffer.from("image one");
		const second = Buffer.from("image two!");
		await expectArchive({
			format: ucgFormat,
			archive: buildUcg([
				{ name: "cg001", content: first },
				{ name: "cg002", content: second },
			]),
			sourcePath: "CG01",
			entries: [
				{ path: "cg001", size: first.length, content: first },
				{ path: "cg002", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a blank name", async () => {
		const archive = buildUcg([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + 0x14);
		await expectArchive({
			format: ucgFormat,
			archive,
			sourcePath: "data",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset inside the index", async () => {
		const archive = buildUcg([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(INDEX_OFFSET, INDEX_OFFSET + 0x14);
		await expectArchive({
			format: ucgFormat,
			archive,
			sourcePath: "data",
			detected: false,
			entries: [],
		});
	});

	it("rejects a wrong signature byte", async () => {
		const archive = buildUcg([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt8(0x65, 0);
		await expectArchive({
			format: ucgFormat,
			archive,
			sourcePath: "data",
			detected: false,
			entries: [],
		});
	});
});
