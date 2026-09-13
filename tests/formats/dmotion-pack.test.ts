import { encodeCp932 } from "@garbro-mcp/core";
import { dmotionPackFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET_OFFSET = 0x18;

interface DmotionEntry {
	stem: string;
	content: Buffer;
}

/** Groups entries by extension the way the engine stores its per-extension directories. */
function buildDmotion(
	groups: readonly { extension: string; entries: readonly DmotionEntry[] }[],
): Buffer {
	const extensionOffset = INDEX_OFFSET_OFFSET + 4;
	const extensionTableSize = groups.length * 0x10;
	let cursor = extensionOffset + extensionTableSize;
	const directoryOffsets = groups.map((group) => {
		const offset = cursor;
		cursor += group.entries.length * 0x10;
		return offset;
	});
	const dataOffset = cursor;
	const archive = Buffer.alloc(
		dataOffset +
			groups.reduce(
				(sum, group) =>
					sum +
					group.entries.reduce(
						(inner, entry) => inner + entry.content.length,
						0,
					),
				0,
			),
	);
	archive.write("PACK", 0, "ascii");
	archive.write("FILE100DATA", 4, "ascii");
	archive.write(".\\\\\\", 0x10, "ascii");
	archive.writeUInt16LE(groups.length, 0x16);
	archive.writeUInt32LE(extensionOffset, INDEX_OFFSET_OFFSET);
	let dataPosition = dataOffset;
	for (const [groupIndex, group] of groups.entries()) {
		const table = extensionOffset + groupIndex * 0x10;
		encodeCp932(group.extension).copy(archive, table);
		archive.writeUInt16LE(group.entries.length, table + 6);
		archive.writeUInt32LE(directoryOffsets[groupIndex] ?? 0, table + 8);
		archive.writeUInt32LE(group.entries.length * 0x10, table + 12);
		let entryPosition = directoryOffsets[groupIndex] ?? 0;
		for (const entry of group.entries) {
			encodeCp932(entry.stem).copy(archive, entryPosition);
			archive.writeUInt32LE(dataPosition, entryPosition + 8);
			archive.writeUInt32LE(entry.content.length, entryPosition + 12);
			entry.content.copy(archive, dataPosition);
			dataPosition += entry.content.length;
			entryPosition += 0x10;
		}
	}
	return archive;
}

describe("D-Motion resource archive", () => {
	it("joins 8-byte stems with their directory extension", async () => {
		await expectArchive({
			format: dmotionPackFormat,
			archive: buildDmotion([
				{
					extension: ".bmp",
					entries: [
						{ stem: "title  ", content: Buffer.from("bitmap") },
						{ stem: "face", content: Buffer.from("face") },
					],
				},
				{
					extension: ".wav",
					entries: [{ stem: "se01", content: Buffer.from("audio!") }],
				},
			]),
			entries: [
				{ path: "title.bmp", size: 6, content: Buffer.from("bitmap") },
				{ path: "face.bmp", size: 4, content: Buffer.from("face") },
				{ path: "se01.wav", size: 6, content: Buffer.from("audio!") },
			],
			metadata: { entryCount: 3 },
		});
	});

	it("rejects a missing engine marker", async () => {
		const archive = buildDmotion([
			{
				extension: ".bmp",
				entries: [{ stem: "a", content: Buffer.from("a") }],
			},
		]);
		archive.write("FILE200DATA", 4, "ascii");
		await expectArchive({
			format: dmotionPackFormat,
			archive,
			detected: false,
			entries: [],
		});
	});
});
