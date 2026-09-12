import { nppFormat } from "@garbro-mcp/formats";
import { encodeCp932 } from "@garbro-mcp/core";
import { expectArchive } from "../helpers/archive.js";
import { literalLzssStream } from "../helpers/lzss.js";
import { describe, it } from "vitest";

interface NppEntry {
	subdir: string;
	name: string;
	content: Buffer;
	packed?: boolean;
}

function buildNpp(entries: NppEntry[]): Buffer {
	const indexOffset = 8;
	const indexSize = entries.length * 0x90;
	const dataOffset = indexOffset + indexSize;
	const payloads = entries.map((entry) =>
		entry.packed ? literalLzssStream(entry.content) : entry.content,
	);
	const total =
		dataOffset + payloads.reduce((sum, payload) => sum + payload.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("nitP", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x90;
		archive.writeUInt32LE(offset, record);
		const payload = payloads[id] ?? Buffer.alloc(0);
		archive.writeUInt32LE(payload.length, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		archive.writeInt16LE(entry.packed ? 1 : 0, record + 0x0c);
		encodeCp932(entry.subdir).copy(archive, record + 0x10);
		encodeCp932(entry.name).copy(archive, record + 0x50);
		payload.copy(archive, offset);
		offset += payload.length;
	}
	return archive;
}

describe("Nitro+ NPP archive", () => {
	it("reads hierarchical names and LZSS-compressed entries", async () => {
		const packedContent = Buffer.from("compressed payload");
		await expectArchive({
			format: nppFormat,
			archive: buildNpp([
				{ subdir: "data", name: "one.npk", content: Buffer.from("plain") },
				{ subdir: "", name: "two.npk", content: packedContent, packed: true },
			]),
			entries: [
				{ path: "data/one.npk", size: 5, content: Buffer.from("plain") },
				{
					path: "two.npk",
					size: literalLzssStream(packedContent).length,
					content: packedContent,
				},
			],
			metadata: { entryCount: 2 },
		});
	});
});
