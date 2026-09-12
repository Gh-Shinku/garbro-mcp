import { encodeCp932 } from "@garbro-mcp/core";
import { szsFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildSzs(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x10;
	const indexSize = entries.length * 0x110;
	const firstOffset = indexOffset + indexSize;
	const total =
		firstOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("SZS100__", 0, "ascii");
	archive.writeInt32LE(entries.length, 0x0c);
	let offset = firstOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x110;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeBigInt64LE(BigInt(offset), record + 0x100);
		archive.writeUInt32LE(entry.content.length, record + 0x108);
		for (let position = 0; position < entry.content.length; position += 1) {
			archive[offset + position] = (entry.content[position] ?? 0) ^ 0x90;
		}
		offset += entry.content.length;
	}
	return archive;
}

describe("SLG SZS archive", () => {
	it("decrypts entries with XOR 0x90 and maps ';' to '/'", async () => {
		await expectArchive({
			format: szsFormat,
			archive: buildSzs([
				{ name: "cg;001.bmp", content: Buffer.from("aa") },
				{ name: "sound.wav", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "cg/001.bmp", size: 2, content: Buffer.from("aa") },
				{ path: "sound.wav", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
