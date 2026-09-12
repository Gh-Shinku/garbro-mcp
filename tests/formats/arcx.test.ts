import { encodeCp932 } from "@garbro-mcp/core";
import { arcxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildArcx(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexOffset = 0x10;
	const recordSize = 100 + 0x1c;
	const dataOffset = indexOffset + entries.length * recordSize;
	const payloads = entries.map((entry) =>
		entry.packed ? literalLzssStream(entry.content) : entry.content,
	);
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("ARCX", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * recordSize;
		encodeCp932(entry.name).copy(archive, record);
		const data = record + 100;
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(offset, data);
		archive.writeUInt32LE(payload.length, data + 4);
		archive.writeUInt32LE(entry.content.length, data + 8);
		archive.writeUInt8(entry.packed ? 1 : 0, data + 0x13);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("ARCX archive", () => {
	it("reads 100-byte names and decompresses packed entries", async () => {
		const content = Buffer.from("packed data");
		await expectArchive({
			format: arcxFormat,
			archive: buildArcx([
				{ name: "raw.bin", content: Buffer.from("aa") },
				{ name: "dir\\packed.bin", content, packed: true },
			]),
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "dir/packed.bin",
					size: literalLzssStream(content).length,
					content,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
