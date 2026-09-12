import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { kpcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

function buildKpc(entries: { name: string; content: Buffer }[]): {
	archive: Buffer;
	indexSize: number;
} {
	const indexOffset = 0x20;
	const recordSize = 0x20;
	const indexSize = entries.length * recordSize;
	const dataOffset = indexOffset + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("SCRPACK1", 0, "ascii");
	archive.writeInt32LE(entries.length, 8);
	archive.writeUInt32LE(indexSize, 0x0c);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = indexOffset + index * recordSize;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset, record + 0x18);
		archive.writeUInt32LE(entry.content.length, record + 0x1c);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	for (
		let position = indexOffset;
		position < indexOffset + indexSize;
		position += 1
	) {
		archive[position] = (archive[position] ?? 0) ^ 0x45;
	}
	return { archive, indexSize };
}

describe("KScript KPC archive", () => {
	it("decodes the XOR-0x45 index", async () => {
		const fixture = buildKpc([
			{ name: "start.ks", content: Buffer.from("script") },
			{ name: "data\\x.bin", content: Buffer.from("xx") },
		]);
		await expectArchive({
			format: kpcFormat,
			archive: fixture.archive,
			entries: [
				{ path: "start.ks", size: 6, content: Buffer.from("script") },
				{ path: "data/x.bin", size: 2, content: Buffer.from("xx") },
			],
			metadata: { entryCount: 2, indexSize: fixture.indexSize },
		});
	});

	it("rejects a size index that runs past the file", async () => {
		const fixture = buildKpc([{ name: "a.ks", content: Buffer.from("a") }]);
		fixture.archive.writeUInt32LE(0x1000, 0x0c);
		expect(await kpcFormat.detect(new BufferByteSource(fixture.archive))).toBe(
			false,
		);
	});
});
