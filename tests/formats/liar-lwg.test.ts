import { encodeCp932 } from "@garbro-mcp/core";
import { lwgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildLwg(entries: { name: string; content: Buffer }[]): Buffer {
	const dirOffset = 24;
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(18 + name.length);
		record.writeInt32LE(1, 0);
		record.writeInt32LE(2, 4);
		record.writeUInt8(32, 8);
		record.writeUInt8(name.length, 17);
		name.copy(record, 18);
		return record;
	});
	const dirSize = records.reduce((sum, record) => sum + record.length, 0);
	const dataOffset = dirOffset + dirSize;
	const dataSize = entries.reduce(
		(sum, entry) => sum + entry.content.length,
		0,
	);
	const total = dataOffset + 4 + dataSize;
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(0x0001474c, 0);
	archive.writeUInt32LE(480, 4);
	archive.writeUInt32LE(640, 8);
	archive.writeInt32LE(entries.length, 12);
	archive.writeUInt32LE(dirSize, 20);
	let recordOffset = dirOffset;
	let dataPosition = dataOffset + 4;
	for (const [id, entry] of entries.entries()) {
		const record = records[id] ?? Buffer.alloc(0);
		record.copy(archive, recordOffset);
		archive.writeUInt32LE(dataPosition - (dataOffset + 4), recordOffset + 9);
		archive.writeUInt32LE(entry.content.length, recordOffset + 13);
		entry.content.copy(archive, dataPosition);
		recordOffset += record.length;
		dataPosition += entry.content.length;
	}
	archive.writeUInt32LE(dataSize, dataOffset);
	return archive;
}

describe("Liar LWG multi-frame image", () => {
	it("reads variable-length records and data-bounded entries", async () => {
		await expectArchive({
			format: lwgFormat,
			archive: buildLwg([
				{ name: "part0", content: Buffer.from("aa") },
				{ name: "part1", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "part0.wcg", size: 2, content: Buffer.from("aa") },
				{ path: "part1.wcg", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { frameCount: 2, width: 640, height: 480 },
		});
	});
});
