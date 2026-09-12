import { encodeCp932 } from "@garbro-mcp/core";
import { karFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildKar(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x0c;
	const indexSize = entries.length * 0x28;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("KAR\0", 0, "binary");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(0, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * 0x28;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x20);
		archive.writeUInt32LE(offset, record + 0x24);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Cadath KAR archive", () => {
	it("deobfuscates ns5/ns6 scripts with a size-derived XOR key", async () => {
		const plain = Buffer.alloc(0x1a, 0x41); // 26 bytes -> key 2 for .ns5
		const obfuscated = Buffer.from(plain);
		for (let index = 0; index < obfuscated.length; index += 1) {
			obfuscated[index] = (obfuscated[index] ?? 0) ^ 2;
		}
		await expectArchive({
			format: karFormat,
			archive: buildKar([
				{ name: "script.ns5", content: obfuscated },
				{ name: "plain.bin", content: Buffer.from("plain") },
			]),
			sourcePath: "data.bin",
			entries: [
				{ path: "script.ns5", size: 0x1a, content: plain },
				{ path: "plain.bin", size: 5, content: Buffer.from("plain") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
