import { encodeCp932 } from "@garbro-mcp/core";
import { panFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildPan(entries: { name: string; content: Buffer }[]): Buffer {
	const indexSize = entries.length * 0x2c;
	const dataOffset = 0x40;
	const payloads = entries.map((entry) => literalLzssStream(entry.content));
	const total =
		dataOffset +
		payloads.reduce((sum, payload) => sum + payload.length, 0) +
		indexSize;
	const indexStart = total - indexSize;
	const archive = Buffer.alloc(total);
	archive.write("Pan ver 1.00", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x10);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexStart + id * 0x2c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x20);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(offset, record + 0x24);
		archive.writeUInt32LE(payload.length, record + 0x28);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Pan engine archive", () => {
	it("reads a trailing index and decompresses every entry", async () => {
		const content = Buffer.from("pan payload");
		await expectArchive({
			format: panFormat,
			archive: buildPan([{ name: "file.bin", content }]),
			entries: [
				{
					path: "file.bin",
					size: literalLzssStream(content).length,
					content,
				},
			],
			metadata: { entryCount: 1 },
		});
	});
});
