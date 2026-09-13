import { encodeCp932 } from "@garbro-mcp/core";
import { tcd1Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;

function buildTcd1(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const count = entries.length;
	const tableSize = (count + 1) * 4;
	let offset = INDEX_OFFSET + tableSize;
	const offsets = entries.map((entry) => {
		const current = offset;
		offset += entry.content.length;
		return current;
	});
	offsets.push(offset);
	const namesOffset = offset;
	const names = Buffer.concat(
		entries.map((entry) =>
			Buffer.concat([encodeCp932(entry.name), Buffer.from([0])]),
		),
	);
	const archive = Buffer.alloc(namesOffset + names.length);
	archive.write("TCD1", 0, "ascii");
	archive.writeInt32LE(count, 4);
	archive.writeUInt32LE(INDEX_OFFSET, 8);
	archive.writeUInt32LE(namesOffset, 12);
	for (let id = 0; id < count; id += 1) {
		// The final offset is stored plainly; the others are shifted by their position.
		const correction = (INDEX_OFFSET << ((id & 7) + 8)) >>> 0;
		archive.writeUInt32LE(
			((offsets[id] ?? 0) + correction) >>> 0,
			INDEX_OFFSET + id * 4,
		);
	}
	archive.writeUInt32LE(offsets[count] ?? 0, INDEX_OFFSET + count * 4);
	let position = offsets[0] ?? 0;
	for (const entry of entries) {
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	for (const [index, value] of names.entries())
		archive[namesOffset + index] = value === 0 ? 0 : (value + 0x57) & 0xff;
	return archive;
}

describe("TopCat TCD1 archive", () => {
	it("decodes position-shifted offsets and masked names", async () => {
		await expectArchive({
			format: tcd1Format,
			archive: buildTcd1([
				{ name: "first.dat", content: Buffer.from("one") },
				{ name: "音声/second.dat", content: Buffer.from("two!") },
			]),
			sourcePath: "sample.tcd",
			entries: [
				{ path: "first.dat", size: 3, content: Buffer.from("one") },
				{ path: "音声/second.dat", size: 4, content: Buffer.from("two!") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an offset table that exceeds the file", async () => {
		const archive = buildTcd1([{ name: "a.dat", content: Buffer.from("a") }]);
		archive.writeInt32LE(0x400, 4);
		await expectArchive({
			format: tcd1Format,
			archive,
			sourcePath: "sample.tcd",
			detected: false,
			entries: [],
		});
	});
});
