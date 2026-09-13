import { encodeCp932 } from "@garbro-mcp/core";
import { vfsFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
/** A version one record holds a 0x13-byte name field and four words, so it needs at least 0x24 bytes. */
const V1_ENTRY_SIZE = 0x24;
const V2_ENTRY_SIZE = 0x18;
const V2_POOL_HEADER = 8;

interface Entry {
	name: string;
	content: Buffer;
}

/** Version one stores each name inside its own record, behind a header of eight words. */
function buildV1(entries: readonly Entry[]): Buffer {
	const dataOffset = INDEX_OFFSET + V1_ENTRY_SIZE * entries.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("VF", 0, "latin1");
	archive.writeUInt16LE(0x0100, 2);
	archive.writeUInt16LE(entries.length, 4);
	archive.writeUInt16LE(V1_ENTRY_SIZE, 6);
	archive.writeInt32LE(V1_ENTRY_SIZE * entries.length, 8);
	archive.writeUInt32LE(archive.length, 0x0c);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * V1_ENTRY_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(position, record + 0x13);
		archive.writeUInt32LE(entry.content.length, record + 0x17);
		archive.writeUInt32LE(entry.content.length, record + 0x1b);
		archive.writeUInt8(0, record + 0x1f);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	return archive;
}

/** Version two keeps its names in a UTF-16 pool that trails the records. */
function buildV2(entries: readonly Entry[]): Buffer {
	const recordsSize = V2_ENTRY_SIZE * entries.length;
	const poolOffset = INDEX_OFFSET + recordsSize;
	const names: string[] = [];
	const offsets: number[] = [];
	let charCount = 0;
	for (const entry of entries) {
		offsets.push(charCount);
		names.push(entry.name);
		charCount += entry.name.length + 1;
	}
	const poolText = names.map((name) => `${name}\u0000`).join("");
	const poolBytes = Buffer.from(poolText, "utf16le");
	const dataOffset = poolOffset + V2_POOL_HEADER + poolBytes.length;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("VF", 0, "latin1");
	archive.writeUInt16LE(0x0200, 2);
	archive.writeUInt16LE(entries.length, 4);
	archive.writeUInt16LE(V2_ENTRY_SIZE, 6);
	archive.writeInt32LE(recordsSize, 8);
	archive.writeUInt32LE(archive.length, 0x0c);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * V2_ENTRY_SIZE;
		archive.writeInt32LE(offsets[id] ?? 0, record);
		archive.writeUInt32LE(position, record + 0x0a);
		archive.writeUInt32LE(entry.content.length, record + 0x0e);
		archive.writeUInt32LE(entry.content.length, record + 0x12);
		archive.writeUInt8(0, record + 0x16);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	archive.writeInt32LE(charCount, poolOffset);
	poolBytes.copy(archive, poolOffset + V2_POOL_HEADER);
	return archive;
}

describe("Aoi VFS resource archive", () => {
	it("reads a version one archive with in-record names", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: vfsFormat,
			archive: buildV1([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.vfs",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("reads a version two archive with its UTF-16 name pool", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		await expectArchive({
			format: vfsFormat,
			archive: buildV2([
				{ name: "one.dat", content: first },
				{ name: "two.dat", content: second },
			]),
			sourcePath: "sample.vfs",
			entries: [
				{ path: "one.dat", size: first.length, content: first },
				{ path: "two.dat", size: second.length, content: second },
			],
		});
	});

	it("rejects a foreign signature", async () => {
		const content = Buffer.from("body");
		const archive = buildV1([{ name: "one.dat", content }]);
		archive.write("XX", 0, "latin1");
		await expectArchive({
			format: vfsFormat,
			archive,
			sourcePath: "sample.vfs",
			detected: false,
			entries: [],
		});
	});

	it("rejects a file size that disagrees", async () => {
		const content = Buffer.from("body");
		const archive = buildV1([{ name: "one.dat", content }]);
		archive.writeUInt32LE(archive.length + 4, 0x0c);
		await expectArchive({
			format: vfsFormat,
			archive,
			sourcePath: "sample.vfs",
			detected: false,
			entries: [],
		});
	});

	it("requires the vfs extension", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: vfsFormat,
			archive: buildV1([{ name: "one.dat", content }]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
