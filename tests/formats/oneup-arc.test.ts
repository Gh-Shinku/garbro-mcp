import { oneUpArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildOneUp(entries: { name: string; content: Buffer }[]): Buffer {
	const names = entries.map((entry) => Buffer.from(entry.name, "utf16le"));
	const indexSize = entries.reduce(
		(sum, _entry, index) => sum + 4 + (names[index]?.length ?? 0) + 4,
		0,
	);
	const dataOffset = 0x0c + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(0, 0);
	archive.write("ARC", 1, "ascii");
	archive.writeUInt32LE(dataOffset, 4);
	archive.writeInt32LE(entries.length, 8);
	let position = 0x0c;
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const name = names[index] ?? Buffer.alloc(0);
		archive.writeUInt32LE(name.length, position);
		position += 4;
		name.copy(archive, position);
		position += name.length;
		archive.writeUInt32LE(entry.content.length, position);
		position += 4;
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("One-up ARC archive", () => {
	it("reads UTF-16LE names and sequential payloads", async () => {
		await expectArchive({
			format: oneUpArcFormat,
			archive: buildOneUp([
				{ name: "画像\\a.g", content: Buffer.from("aa") },
				{ name: "script.ks", content: Buffer.from("bbb") },
			]),
			entries: [
				{ path: "画像/a.g", size: 2, content: Buffer.from("aa") },
				{ path: "script.ks", size: 3, content: Buffer.from("bbb") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
