import { encodeCp932 } from "@garbro-mcp/core";
import { alphaSystemPakFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

function buildAlphaSystem(
	entries: { name: string; content: Buffer }[],
): Buffer {
	const firstOffset = entries.length * 0x30 + 4;
	const total =
		firstOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeInt32LE(entries.length, 0);
	archive.writeInt32LE(firstOffset, 0x30);
	let offset = firstOffset;
	for (const [id, entry] of entries.entries()) {
		const record = 4 + id * 0x30;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(entry.content.length, record + 0x24);
		archive.writeUInt32LE(offset, record + 0x2c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

describe("Alpha System PAK archive", () => {
	it("validates the first offset and reads 0x30-byte records", async () => {
		await expectArchive({
			format: alphaSystemPakFormat,
			archive: buildAlphaSystem([
				{ name: "a.sfg", content: Buffer.from("aa") },
				{ name: "b.wav", content: Buffer.from("b") },
			]),
			entries: [
				{ path: "a.sfg", size: 2, content: Buffer.from("aa") },
				{ path: "b.wav", size: 1, content: Buffer.from("b") },
			],
			metadata: { entryCount: 2 },
		});
	});
});
