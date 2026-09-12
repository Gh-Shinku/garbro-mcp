import { encodeCp932 } from "@garbro-mcp/core";
import { crgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { deflateSync } from "node:zlib";
import { describe, it } from "vitest";

function buildCrg(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 8;
	const recordSize = 60;
	const indexSize = entries.length * recordSize;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("CRG\0", 0, "binary");
	archive.writeInt32LE(entries.length, 4);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * recordSize;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		encodeCp932(entry.name).copy(archive, record + 8);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("RHSS CRG archive", () => {
	it("decompresses CMP-tagged entries with zlib and XOR 0xFF", async () => {
		const plain = Buffer.from("compressed payload");
		const obfuscated = Buffer.from(plain);
		for (let index = 0; index < obfuscated.length; index += 1) {
			obfuscated[index] = (obfuscated[index] ?? 0) ^ 0xff;
		}
		const deflated = deflateSync(obfuscated);
		const compressed = Buffer.concat([
			Buffer.from("CMP\0", "binary"),
			Buffer.alloc(0x4c),
			deflated,
		]);
		await expectArchive({
			format: crgFormat,
			archive: buildCrg([
				{ name: "raw.bin", content: Buffer.from("aa") },
				{ name: "packed.bin", content: compressed },
			]),
			entries: [
				{ path: "raw.bin", size: 2, content: Buffer.from("aa") },
				{ path: "packed.bin", size: compressed.length, content: plain },
			],
			metadata: { entryCount: 2 },
		});
	});
});
