import { encodeCp932 } from "@garbro-mcp/core";
import { mnvFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;

interface MnvEntry {
	name: string;
	content: Buffer;
}

function buildMnv(entries: readonly MnvEntry[], nameSize = 100): Buffer {
	const indexSize = (nameSize + 8) * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * (nameSize + 8);
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + nameSize);
		archive.writeUInt32LE(offset, record + nameSize + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

describe("M no Violet DAT archive", () => {
	it("reads a 100-byte name index", async () => {
		const first = Buffer.from("first entry");
		const second = Buffer.from("second");
		await expectArchive({
			format: mnvFormat,
			archive: buildMnv([
				{ name: "data/one.bin", content: first },
				{ name: "two.bin", content: second },
			]),
			sourcePath: "sample.dat",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "two.bin", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("probes narrower name fields", async () => {
		const content = Buffer.from("payload");
		await expectArchive({
			format: mnvFormat,
			archive: buildMnv([{ name: "a.bin", content }], 44),
			sourcePath: "sample.dat",
			entries: [{ path: "a.bin", size: content.length, content }],
		});
	});

	it("rejects a first offset that does not close the index", async () => {
		const archive = buildMnv([{ name: "a.bin", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x100, INDEX_OFFSET + 100 + 4);
		await expectArchive({
			format: mnvFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});

	it("requires the dat extension", async () => {
		await expectArchive({
			format: mnvFormat,
			archive: buildMnv([{ name: "a.bin", content: Buffer.from("x") }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
