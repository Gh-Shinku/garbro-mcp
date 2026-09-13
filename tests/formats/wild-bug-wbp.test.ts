import { encodeCp932 } from "@garbro-mcp/core";
import { wbpFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const COUNT_OFFSET = 0x10;
const INDEX_OFFSET_FIELD = 0x14;
const INDEX_SIZE_FIELD = 0x18;
const DATA_OFFSET_FIELD = 0x1c;

function checksum(name: Buffer): number {
	let value = 0;
	for (const byte of name) value = (value + byte) & 0xff;
	return value;
}

function head(version: number): Buffer {
	const header = Buffer.alloc(0x20);
	header.write("ARCFORM", 0, "ascii");
	header.writeUInt8(0x30 + version, 7);
	header.write(" WBUG ", 8, "ascii");
	return header;
}

/** Version 3 records are a 0x14-byte header with a name length byte and the name behind it. */
function buildV3(
	version: number,
	entries: readonly { name: string; content: Buffer }[],
): Buffer {
	const records = entries.map((entry) => {
		const name = encodeCp932(entry.name);
		const record = Buffer.alloc(0x14 + name.length);
		record.writeUInt8(name.length, 9);
		name.copy(record, 0x14);
		return record;
	});
	const indexSize = records.reduce((sum, record) => sum + record.length, 0);
	const indexOffset = 0x20;
	const dataOffset = indexOffset + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	head(version).copy(archive, 0);
	archive.writeInt32LE(entries.length, COUNT_OFFSET);
	archive.writeUInt32LE(indexOffset, INDEX_OFFSET_FIELD);
	archive.writeUInt32LE(indexSize, INDEX_SIZE_FIELD);
	archive.writeUInt32LE(dataOffset, DATA_OFFSET_FIELD);
	let position = indexOffset;
	let data = dataOffset;
	for (const [id, record] of records.entries()) {
		record.copy(archive, position);
		// The offset and size live in the record's own first eight bytes.
		archive.writeUInt32LE(data, position);
		archive.writeUInt32LE(entries[id]?.content.length ?? 0, position + 4);
		entries[id]?.content.copy(archive, data);
		data += entries[id]?.content.length ?? 0;
		position += record.length;
	}
	return archive;
}

/** Version 4 stores hash chains for directories and resources behind two 0x100-entry tables. */
function buildV4(
	directoryName: string,
	resourceName: string,
	content: Buffer,
): Buffer {
	const dirBytes = encodeCp932(directoryName);
	const resBytes = encodeCp932(resourceName);
	const dirHash = checksum(dirBytes);
	const resHash = checksum(resBytes);

	const dirRecord = Buffer.alloc(5 + dirBytes.length);
	dirRecord.writeUInt8(dirHash, 0);
	dirRecord.writeUInt8(dirBytes.length, 1);
	dirRecord.writeUInt16LE(1, 2);
	dirBytes.copy(dirRecord, 4);

	const resRecord = Buffer.alloc((0x18 + resBytes.length + 3) & ~3);
	resRecord.writeUInt8(resHash, 0);
	resRecord.writeUInt8(resBytes.length, 1);
	resRecord.writeUInt16LE(1, 2);
	resBytes.copy(resRecord, 0x14);

	const indexOffset = 0x824;
	const indexSize = dirRecord.length + resRecord.length;
	const dataOffset = indexOffset + indexSize;
	const archive = Buffer.alloc(dataOffset + content.length);
	head(4).copy(archive, 0);
	archive.writeInt32LE(1, COUNT_OFFSET);
	archive.writeUInt32LE(indexOffset, INDEX_OFFSET_FIELD);
	archive.writeUInt32LE(indexSize, INDEX_SIZE_FIELD);
	archive.writeUInt32LE(dataOffset, DATA_OFFSET_FIELD);
	dirRecord.copy(archive, indexOffset);
	resRecord.copy(archive, indexOffset + dirRecord.length);
	archive.writeUInt32LE(indexOffset, 0x24 + dirHash * 4);
	archive.writeUInt32LE(indexOffset + dirRecord.length, 0x424 + resHash * 4);
	archive.writeUInt32LE(dataOffset, indexOffset + dirRecord.length + 4);
	archive.writeUInt32LE(content.length, indexOffset + dirRecord.length + 8);
	content.copy(archive, dataOffset);
	return archive;
}

describe("Wild Bug WBP resource archive", () => {
	it("reads version 3 records", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: wbpFormat,
			archive: buildV3(3, [
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.wbp",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("reads version 2 records the same way", async () => {
		const content = Buffer.from("older body");
		await expectArchive({
			format: wbpFormat,
			archive: buildV3(2, [{ name: "old.dat", content }]),
			sourcePath: "sample.wbp",
			entries: [{ path: "old.dat", size: content.length, content }],
		});
	});

	it("reads version 4 hash chains and joins the directory name", async () => {
		const content = Buffer.from("hash body");
		await expectArchive({
			format: wbpFormat,
			archive: buildV4("\\sub\\", "file.bin", content),
			sourcePath: "sample.wbp",
			entries: [{ path: "sub/file.bin", size: content.length, content }],
		});
	});

	it("rejects an unsupported version", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: wbpFormat,
			archive: buildV3(5, [{ name: "one.dat", content }]),
			sourcePath: "sample.wbp",
			detected: false,
			entries: [],
		});
	});

	it("rejects a foreign tail marker", async () => {
		const content = Buffer.from("body");
		const archive = buildV3(3, [{ name: "one.dat", content }]);
		archive.write(" WBUH ", 8, "ascii");
		await expectArchive({
			format: wbpFormat,
			archive,
			sourcePath: "sample.wbp",
			detected: false,
			entries: [],
		});
	});
});
