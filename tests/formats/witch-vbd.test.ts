import { encodeCp932 } from "@garbro-mcp/core";
import { vbdFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildVbd(entries: { name: string; content: Buffer }[]): Buffer {
	const headerSize = 0x0e;
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(8 + name.length);
		record.writeInt32LE(name.length, 4);
		name.copy(record, 8);
		return record;
	});
	const indexSize = records.reduce((sum, record) => sum + record.length, 0);
	const dataOffset = headerSize + indexSize;
	let offset = dataOffset;
	for (const [id, record] of records.entries()) {
		record.writeUInt32LE(offset, 0);
		offset += entries[id]?.content.length ?? 0;
	}
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("SOUNDDATE ", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x0a);
	let position = headerSize;
	for (const record of records) {
		record.copy(archive, position);
		position += record.length;
	}
	offset = dataOffset;
	for (const entry of entries) {
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Witch SOUNDDATE audio archive", () => {
	it("reads interleaved offsets and length-prefixed names", async () => {
		await expectArchive({
			format: vbdFormat,
			archive: buildVbd([
				{ name: "voice01.wav", content: Buffer.from("aa") },
				{ name: "voice02.wav", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "voice01.wav", size: 2, content: Buffer.from("aa") },
				{ path: "voice02.wav", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
