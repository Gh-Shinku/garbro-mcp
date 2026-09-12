import { encodeCp932 } from "@garbro-mcp/core";
import { irrlichtArkFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildArk(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 4;
	const recordSize = 0x10c;
	const dataOffset = indexOffset + entries.length * recordSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = indexOffset + id * recordSize;
		const name = encodeCp932(entry.name);
		for (let index = 0; index < name.length; index += 1) {
			archive[record + index] = (name[index] ?? 0) ^ 0xff;
		}
		archive[record + name.length] = 0xff;
		archive.writeUInt32LE(offset, record + 0x104);
		archive.writeUInt32LE(entry.content.length, record + 0x108);
		const obfuscated = Buffer.from(entry.content);
		for (let index = 0; index < obfuscated.length; index += 1) {
			obfuscated[index] = (obfuscated[index] ?? 0) ^ 0xff;
		}
		obfuscated.copy(archive, offset);
		offset += obfuscated.length;
	}
	return archive;
}

describe("Irrlicht ARK archive", () => {
	it("deobfuscates XOR-0xFF names and payloads", async () => {
		await expectArchive({
			format: irrlichtArkFormat,
			archive: buildArk([
				{ name: "a.bin", content: Buffer.from("aa") },
				{ name: "dir\\b.bin", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "a.bin", size: 2, content: Buffer.from("aa") },
				{ path: "dir/b.bin", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
