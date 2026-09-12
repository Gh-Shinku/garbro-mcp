import { taskforceDatFormat } from "@garbro-mcp/formats";
import { encodeCp932 } from "@garbro-mcp/core";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

function buildTaskforce(
	entries: { name: string; content: Buffer; packed?: boolean }[],
): Buffer {
	const indexOffset = 0x0c;
	const indexSize = entries.length * 0x10c;
	const dataOffset = indexOffset + indexSize;
	const payloads = entries.map((entry) =>
		entry.packed ? literalLzssStream(entry.content) : entry.content,
	);
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("tskforce", 0, "ascii");
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

describe("Taskforce tskforce archive", () => {
	it("decompresses entries whose packed and unpacked sizes differ", async () => {
		const content = Buffer.from("script body");
		await expectArchive({
			format: taskforceDatFormat,
			archive: buildTaskforce([
				{ name: "raw.bin", content: Buffer.from("aa") },
				{ name: "packed.bin", content, packed: true },
			]),
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
