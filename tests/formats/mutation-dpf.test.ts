import { encodeCp932 } from "@garbro-mcp/core";
import { dpfFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildDpf(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 6;
	const indexSize = entries.length * 0x18;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("DPFL", 0, "ascii");
	archive.writeUInt16LE(entries.length, 4);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x18;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Mutation DPF archive", () => {
	it("reads a 16-bit count and 0x18-strided index", async () => {
		await expectArchive({
			format: dpfFormat,
			archive: buildDpf([
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
