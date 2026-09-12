import { encodeCp932 } from "@garbro-mcp/core";
import { ml2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildMl2(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x40;
	const index = Buffer.concat([
		...entries.map((entry) => {
			const name = encodeCp932(entry.name);
			const record = Buffer.alloc(5 + name.length);
			record.writeUInt32LE(entry.content.length, 0);
			record.writeUInt8(name.length, 4);
			name.copy(record, 5);
			return record;
		}),
		Buffer.from([0xff, 0xff, 0xff, 0xff]),
	]);
	const dataOffset = indexOffset + index.length;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ML200", 0, "ascii");
	archive.writeUInt16LE(dataOffset, 6);
	archive.writeInt32LE(entries.length, 8);
	archive.writeUInt32LE(index.length, 0x0c);
	archive.writeUInt32LE(indexOffset, 0x10);
	index.copy(archive, indexOffset);
	let offset = dataOffset;
	for (const entry of entries) {
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Mina ML200 archive", () => {
	it("reads length-prefixed names after a 0xffffffff terminator check", async () => {
		await expectArchive({
			format: ml2Format,
			archive: buildMl2([
				{ name: "a.g", content: Buffer.from("aa") },
				{ name: "b.g", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.g", size: 2, content: Buffer.from("aa") },
				{ path: "b.g", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
