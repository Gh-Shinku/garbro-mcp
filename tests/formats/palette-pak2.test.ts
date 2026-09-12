import { encodeCp932 } from "@garbro-mcp/core";
import { pak2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildPak2(entries: { name: string; content: Buffer }[]): Buffer {
	const indexOffset = 0x0a;
	let indexSize = 0;
	const nameFields = entries.map((entry) => {
		const plain = encodeCp932(entry.name);
		const stored = Buffer.from(plain);
		for (let index = 0; index < stored.length; index += 1) {
			stored[index] = (stored[index] ?? 0) ^ 0xff;
		}
		indexSize += 1 + stored.length + 8;
		return Buffer.concat([Buffer.from([stored.length]), stored]);
	});
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt8(0x05, 0);
	archive.write("PACK2", 1, "ascii");
	archive.writeInt32LE(entries.length, 6);
	let position = indexOffset;
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const nameField = nameFields[id] ?? Buffer.alloc(0);
		nameField.copy(archive, position);
		position += nameField.length;
		archive.writeUInt32LE(offset, position);
		archive.writeUInt32LE(entry.content.length, position + 4);
		position += 8;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Palette PACK2 archive", () => {
	it("reads length-prefixed XOR-0xFF names", async () => {
		await expectArchive({
			format: pak2Format,
			archive: buildPak2([
				{ name: "cg\\a.pga", content: Buffer.from("aa") },
				{ name: "b.ogg", content: Buffer.from("b") },
			]),
			sourcePath: "data.pak",
			entries: [
				{ path: "cg/a.pga", size: 2, content: Buffer.from("aa") },
				{ path: "b.ogg", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
