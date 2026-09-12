import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { valkyriaAm2Format, valkyriaDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, expect, it } from "vitest";

function buildValkyriaDat(
	entries: { name: string; content: Buffer }[],
): Buffer {
	const indexSize = entries.length * 0x10c;
	const dataOffset = 4 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(indexSize, 0);
	let offset = dataOffset;
	for (const [index, entry] of entries.entries()) {
		const record = 4 + index * 0x10c;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(offset - dataOffset, record + 0x104);
		archive.writeUInt32LE(entry.content.length, record + 0x108);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return archive;
}

function buildAm2(contents: Buffer[]): Buffer {
	const baseOffset = 0x20;
	const total =
		baseOffset + contents.reduce((sum, content) => sum + content.length, 0);
	const archive = Buffer.alloc(total);
	archive.writeUInt32LE(baseOffset - 12, 0);
	archive.writeInt32LE(contents.length, 4);
	let offset = baseOffset;
	for (const [index, content] of contents.entries()) {
		const record = 12 + index * 0x0c;
		archive.writeUInt32LE(offset - baseOffset, record);
		archive.writeUInt32LE(content.length, record + 4);
		content.copy(archive, offset);
		offset += content.length;
	}
	return archive;
}

describe("Valkyria DAT archive", () => {
	it("reads a 0x10c-strided index with a declared index size", async () => {
		await expectArchive({
			format: valkyriaDatFormat,
			archive: buildValkyriaDat([
				{ name: "a.txt", content: Buffer.from("one") },
				{ name: "dir\\b.txt", content: Buffer.from("two") },
			]),
			entries: [
				{ path: "a.txt", size: 3, content: Buffer.from("one") },
				{ path: "dir/b.txt", size: 3, content: Buffer.from("two") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects an index size that is not a multiple of the record size", async () => {
		const archive = buildValkyriaDat([
			{ name: "a.txt", content: Buffer.from("one") },
		]);
		archive.writeUInt32LE(0x10d, 0);
		expect(await valkyriaDatFormat.detect(new BufferByteSource(archive))).toBe(
			false,
		);
	});
});

describe("Valkyria AM2 multi-frame image", () => {
	it("reads base-relative frames and only detects .am2 files", async () => {
		expect(
			await valkyriaAm2Format.detect(
				new BufferByteSource(buildAm2([Buffer.from("ff")])),
				"sample.bin",
			),
		).toBe(false);
		await expectArchive({
			format: valkyriaAm2Format,
			archive: buildAm2([Buffer.from("one"), Buffer.from("two")]),
			sourcePath: "movie.am2",
			entries: [
				{ path: "movie#0000.MG2", size: 3, content: Buffer.from("one") },
				{ path: "movie#0001.MG2", size: 3, content: Buffer.from("two") },
			],
			metadata: { entryCount: 2, baseOffset: 0x20n },
		});
	});
});
