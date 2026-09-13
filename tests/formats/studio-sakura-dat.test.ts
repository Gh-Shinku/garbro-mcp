import { encodeCp932 } from "@garbro-mcp/core";
import { studioSakuraDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildDat(entries: { name: string; payload: Buffer }[]): Buffer {
	const dataOffset = 0x20 + entries.length * 0x110;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((n, entry) => n + entry.payload.length, 0),
	);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 0x20 + id * 0x110;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.payload.length, record + 0x100);
		archive.writeUInt32LE(offset, record + 0x104);
		entry.payload.copy(archive, offset);
		offset += entry.payload.length;
	}
	return archive;
}
describe("Studio Sakura DAT resource archive", () => {
	it("renames pr3 entries and expands ACMPRS03 payloads", async () => {
		const content = Buffer.from("packed");
		const stream = literalLzssStream(content);
		const header = Buffer.alloc(0x24);
		header.write("ACMPRS03", 0, "ascii");
		header.writeUInt32LE(stream.length, 0x14);
		await expectArchive({
			format: studioSakuraDatFormat,
			archive: buildDat([
				{ name: "raw.bin", payload: Buffer.from("raw") },
				{ name: "packed.pr3", payload: Buffer.concat([header, stream]) },
			]),
			entries: [
				{ path: "raw.bin", size: 3, content: Buffer.from("raw") },
				{ path: "packed", size: header.length + stream.length, content },
			],
			metadata: { entryCount: 2 },
		});
	});
});
