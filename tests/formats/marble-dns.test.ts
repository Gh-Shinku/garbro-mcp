import { encodeCp932 } from "@garbro-mcp/core";
import { dnsFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildDns(entries: { name: string; content: Buffer }[]): Buffer {
	const firstOffset = 0x8000;
	const total =
		firstOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	// The index occupies 0..0x8000 and the first payload offset lives at 8.
	archive.writeUInt32LE(firstOffset, 8);
	let offset = firstOffset;
	for (const [id, entry] of entries.entries()) {
		const record = id * 0x10;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 8);
		archive.writeUInt32LE(entry.content.length, record + 12);
		for (let position = 0; position < entry.content.length; position += 1) {
			archive[offset + position] =
				(0x100 - (entry.content[position] ?? 0)) & 0xff;
		}
		offset += entry.content.length;
	}
	return archive;
}

describe("DarkNiteSystem DNS archive", () => {
	it("requires the data.dns name and negates entry bytes", async () => {
		await expectArchive({
			format: dnsFormat,
			archive: buildDns([
				{ name: "script1", content: Buffer.from("aa") },
				{ name: "script2", content: Buffer.from("b") },
			]),
			sourcePath: "data.dns",
			entries: [
				{ path: "script1.S", size: 2, content: Buffer.from("aa") },
				{ path: "script2.S", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
