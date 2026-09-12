import { ifxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildIfx(entries: { content: Buffer }[]): Buffer {
	const indexOffset = 0x20;
	const indexLimit = 0x10000;
	const total =
		indexLimit + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	let offset = indexLimit;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * 0x10;
		archive.writeUInt16LE(1, record);
		archive.writeUInt32LE(offset, record + 4);
		archive.writeUInt32LE(entry.content.length, record + 8);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Winters IFX archive", () => {
	it("reads the fixed 0x10000 descriptor area", async () => {
		await expectArchive({
			format: ifxFormat,
			archive: buildIfx([
				{ content: Buffer.from("first") },
				{ content: Buffer.from("second") },
			]),
			sourcePath: "data.ifx",
			entries: [
				{ path: "data#00000", size: 5, content: Buffer.from("first") },
				{ path: "data#00001", size: 6, content: Buffer.from("second") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
