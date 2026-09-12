import { encodeCp932 } from "@garbro-mcp/core";
import { asuraPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildAsura(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexOffset = 12;
	const indexSize = entries.length * 0x10c;
	const dataOffset = indexOffset + indexSize;
	const payloads = entries.map((entry) =>
		entry.packed ? literalLzssStream(entry.content) : entry.content,
	);
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("AsuraPak", 0, "binary");
	archive.writeInt32LE(entries.length, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x10c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x100);
		archive.writeUInt32LE(entry.content.length, record + 0x104);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + 0x108);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Asura PAK archive", () => {
	it("decompresses entries whose packed size differs from the unpacked size", async () => {
		const content = Buffer.from("asura payload");
		await expectArchive({
			format: asuraPakFormat,
			archive: buildAsura([
				{ name: "raw.bin", content: Buffer.from("aa") },
				{ name: "packed.bin", content, packed: true },
			]),
			sourcePath: "data.dat",
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{
					path: "packed.bin",
					size: literalLzssStream(content).length,
					content,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
