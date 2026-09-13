import { encodeCp932 } from "@garbro-mcp/core";
import { ucaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const RECORD_SIZE = 0x10;
const NAME_SIZE = 0xc;

/**
 * Builds an index where record `i` carries entry `i`'s data offset. The reader takes the first entry's
 * start from the first word and then bounds each entry with the following record's word, so an entry's
 * size is the gap to the next one and the last entry runs to the end of the file.
 */
function buildUca(
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const indexSize = RECORD_SIZE * entries.length;
	const dataOffset = INDEX_OFFSET + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeInt32LE(entries.length, 4);
	let data = dataOffset;
	const starts: number[] = [];
	for (const entry of entries) {
		starts.push(data);
		data += entry.content.length;
	}
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(starts[id] ?? archive.length, record + NAME_SIZE);
	}
	data = dataOffset;
	for (const entry of entries) {
		entry.content.copy(archive, data);
		data += entry.content.length;
	}
	return archive;
}

describe("West Gate UCA graphics archive", () => {
	it("derives sizes from the following record's offset word", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: ucaFormat,
			archive: buildUca([
				{ name: "one.uca", content: first },
				{ name: "two.uca", content: second },
			]),
			sourcePath: "sample.uca",
			entries: [
				{ path: "one.uca", size: first.length, content: first },
				{ path: "two.uca", size: second.length, content: second },
			],
		});
	});

	it("rejects a non-zero first word", async () => {
		const archive = buildUca([{ name: "one.uca", content: Buffer.from("x") }]);
		archive.writeUInt32LE(1, 0);
		await expectArchive({
			format: ucaFormat,
			archive,
			sourcePath: "sample.uca",
			detected: false,
			entries: [],
		});
	});

	it("rejects consecutive duplicate names", async () => {
		const archive = buildUca([
			{ name: "same.uca", content: Buffer.from("x") },
			{ name: "same.uca", content: Buffer.from("y") },
		]);
		await expectArchive({
			format: ucaFormat,
			archive,
			sourcePath: "sample.uca",
			detected: false,
			entries: [],
		});
	});

	it("rejects an offset that does not move forward", async () => {
		const archive = buildUca([
			{ name: "one.uca", content: Buffer.from("xxxx") },
		]);
		// The final entry is bounded by the file size, so break the first word instead.
		archive.writeUInt32LE(0, INDEX_OFFSET + NAME_SIZE);
		await expectArchive({
			format: ucaFormat,
			archive,
			sourcePath: "sample.uca",
			detected: false,
			entries: [],
		});
	});
});
