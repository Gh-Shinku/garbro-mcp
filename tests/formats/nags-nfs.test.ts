import { encodeCp932 } from "@garbro-mcp/core";
import { nfsFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 4;
const NAME_SIZE = 0x18;
const RECORD_SIZE = 0x20;

interface NfsEntry {
	name: string;
	content: Buffer;
}

function buildNfs(entries: readonly NfsEntry[]): Buffer {
	const count = entries.length;
	const key = count & 0xff;
	const indexSize = count * RECORD_SIZE;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(count, 0);
	let offset = 0;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + NAME_SIZE);
		archive.writeUInt32LE(entry.content.length, record + NAME_SIZE + 4);
		entry.content.copy(archive, position);
		position += entry.content.length;
		offset += entry.content.length;
	}
	for (let index = 0; index < indexSize; index += 1)
		archive[INDEX_OFFSET + index] = (archive[INDEX_OFFSET + index] ?? 0) ^ key;
	return archive;
}

describe("NAGS NFS archive", () => {
	it("decrypts a count-keyed index and inverts .scb scripts", async () => {
		const script = Buffer.from("script text");
		const stored = Buffer.from(script);
		for (const [index, value] of stored.entries())
			stored[index] = ~value & 0xff;
		await expectArchive({
			format: nfsFormat,
			archive: buildNfs([
				{ name: "data/scene.bin", content: Buffer.from("plain data") },
				{ name: "script/main.scb", content: stored },
			]),
			sourcePath: "sample.dat",
			entries: [
				{
					path: "data/scene.bin",
					size: 10,
					content: Buffer.from("plain data"),
				},
				{ path: "script/main.scb", size: script.length, content: script },
			],
			metadata: { entryCount: 2, key: 2 },
		});
	});

	it("rejects an index whose tail word is not a multiple of the key", async () => {
		const archive = buildNfs([{ name: "a.bin", content: Buffer.from("abc") }]);
		archive.writeUInt32LE(1, INDEX_OFFSET + 0x1c);
		await expectArchive({
			format: nfsFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
