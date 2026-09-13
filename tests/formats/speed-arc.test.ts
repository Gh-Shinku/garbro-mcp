import { encodeCp932 } from "@garbro-mcp/core";
import { speedArcFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_TABLE_OFFSET = 0x10;
const RECORD_LENGTH = 0xff;
const DATA_PREFIX = 4;
const IMAGE_PREFIX = 16;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * Builds a REC archive. Named records and the second header are both padded with two extra records,
 * and every payload is preceded by a size word plus an image prefix for image extensions.
 */
function buildArc(entries: readonly Entry[]): Buffer {
	const count = entries.length;
	const recordCount = count;
	const secondOffset = NAME_TABLE_OFFSET + RECORD_LENGTH * (recordCount + 2);
	const tableOffset = secondOffset + 0x10;
	const offsetRecordCount = count;
	const dataOffset = tableOffset + 4 * (offsetRecordCount + 2) + DATA_PREFIX;
	// The offset table points at the block start: images carry twelve header bytes before the size
	// word, every entry carries the size word, and only then comes the payload.
	const blocks = entries.map((entry) => {
		const header = Buffer.alloc(
			entry.name.endsWith(".png") ? IMAGE_PREFIX - DATA_PREFIX : 0,
		);
		const size = Buffer.alloc(4);
		size.writeUInt32LE(entry.content.length, 0);
		return Buffer.concat([header, size, entry.content]);
	});
	const body = Buffer.concat(blocks);
	const archive = Buffer.alloc(dataOffset + body.length);
	archive.writeUInt32LE(RECORD_LENGTH, 0);
	archive.writeUInt32LE(recordCount, 4);
	archive.writeInt32LE(count, 8);
	for (const [id, entry] of entries.entries()) {
		encodeCp932(entry.name).copy(
			archive,
			NAME_TABLE_OFFSET + id * RECORD_LENGTH,
		);
	}
	archive.writeUInt32LE(4, secondOffset);
	archive.writeUInt32LE(offsetRecordCount, secondOffset + 4);
	archive.writeInt32LE(count, secondOffset + 8);
	let position = 0;
	for (const [id] of entries.entries()) {
		archive.writeUInt32LE(position, tableOffset + id * 4);
		position += blocks[id]?.length ?? 0;
	}
	body.copy(archive, dataOffset);
	return archive;
}

describe("REC engine resource archive", () => {
	it("derives sizes from the next entry and reads the declared size word", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second");
		await expectArchive({
			format: speedArcFormat,
			archive: buildArc([
				{ name: "first.dat", content: first },
				{ name: "second.png", content: second },
			]),
			sourcePath: "sample.arc",
			entries: [
				{
					path: "first.dat",
					// The reference subtracts a single size word, so the next image header overshoots.
					size: first.length + IMAGE_PREFIX - DATA_PREFIX,
					content: first,
				},
				{
					path: "second.png",
					// The final entry simply reaches the end of the file.
					size: second.length,
					content: second,
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a head word that is not the signature", async () => {
		const archive = buildArc([{ name: "a.dat", content: Buffer.from("x") }]);
		archive.writeUInt32LE(0x100, 0);
		await expectArchive({
			format: speedArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a second header with a different record length", async () => {
		const archive = buildArc([{ name: "a.dat", content: Buffer.from("x") }]);
		archive.writeUInt32LE(8, NAME_TABLE_OFFSET + RECORD_LENGTH * 3);
		await expectArchive({
			format: speedArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects a second header with a different entry count", async () => {
		const archive = buildArc([{ name: "a.dat", content: Buffer.from("x") }]);
		archive.writeInt32LE(2, NAME_TABLE_OFFSET + RECORD_LENGTH * 3 + 8);
		await expectArchive({
			format: speedArcFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});
});
