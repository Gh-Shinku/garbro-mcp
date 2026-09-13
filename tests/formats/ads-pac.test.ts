import { adsPacFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_SLOT = 0x104;
const ROOT_OFFSET = 4;

/** Names occupy a fixed slot and are stored bitwise inverted. */
function nameSlot(value: string): Buffer {
	const encoded = Buffer.from(encodeCp932(value));
	const slot = Buffer.alloc(NAME_SLOT);
	for (const [index, byte] of encoded.entries()) slot[index] = ~byte & 0xff;
	return slot;
}

function encodeCp932(value: string): Buffer {
	// Only ASCII names are used by these fixtures.
	return Buffer.from(value, "latin1");
}

interface FileRecord {
	name: string;
	size: number;
	offset: number;
	method: number;
}

interface DirectoryRecord {
	name: string;
	offset: number;
}

/** A directory begins with its two counts, then the optional root name, files and subdirectories. */
function buildDirectory(
	files: readonly FileRecord[],
	directories: readonly DirectoryRecord[],
	rootName?: string,
): Buffer {
	const parts: Buffer[] = [];
	const header = Buffer.alloc(8);
	header.writeInt32LE(directories.length, 0);
	header.writeInt32LE(files.length, 4);
	parts.push(header);
	if (rootName !== undefined) parts.push(nameSlot(rootName));
	for (const file of files) {
		const tail = Buffer.alloc(12);
		tail.writeUInt32LE(file.size, 0);
		tail.writeUInt32LE(file.offset, 4);
		tail.writeInt32LE(file.method, 8);
		parts.push(nameSlot(file.name), tail);
	}
	for (const directory of directories) {
		const offset = Buffer.alloc(4);
		offset.writeUInt32LE(directory.offset, 0);
		parts.push(offset, nameSlot(directory.name));
	}
	return Buffer.concat(parts);
}

const ROOT_SIZE = buildDirectory(
	[{ name: "root.txt", size: 0, offset: 0, method: 0 }],
	[{ name: "sub", offset: 0 }],
	"root",
).length;
// Only the root carries a name, so the nested directory has none.
const SUB_SIZE = buildDirectory(
	[{ name: "child.tga", size: 0, offset: 0, method: 0 }],
	[],
).length;

describe("ads engine PAC archive", () => {
	it("walks nested directories and inverted name slots", async () => {
		const rootFile = Buffer.from("root body");
		const childFile = Buffer.from("child body");
		const indexSize = ROOT_OFFSET + ROOT_SIZE + SUB_SIZE;
		const archive = Buffer.alloc(
			indexSize + rootFile.length + childFile.length,
		);
		const subOffset = ROOT_OFFSET + ROOT_SIZE;
		buildDirectory(
			[
				{
					name: "root.txt",
					size: rootFile.length,
					offset: indexSize,
					method: 0,
				},
			],
			[{ name: "sub", offset: subOffset }],
			"root",
		).copy(archive, ROOT_OFFSET);
		buildDirectory(
			[
				{
					name: "child.tga",
					size: childFile.length,
					offset: indexSize + rootFile.length,
					method: 0,
				},
			],
			[],
		).copy(archive, subOffset);
		archive.writeUInt32LE(indexSize, 0);
		rootFile.copy(archive, indexSize);
		childFile.copy(archive, indexSize + rootFile.length);
		await expectArchive({
			format: adsPacFormat,
			archive,
			sourcePath: "sample.pac",
			entries: [
				{ path: "root.txt", size: rootFile.length, content: rootFile },
				{ path: "sub/child.tga", size: childFile.length, content: childFile },
			],
		});
	});

	it("expands RLE payloads", async () => {
		// A literal run of three bytes, then the pattern repeated twice: the stored word is one more
		// than the repeat count.
		const pattern = Buffer.from("ABC");
		const count = Buffer.alloc(4);
		count.writeUInt32LE(3, 0);
		const packed = Buffer.concat([
			Buffer.from([0]),
			pattern,
			Buffer.from([1]),
			count,
		]);
		const indexSize = ROOT_OFFSET + ROOT_SIZE + SUB_SIZE;
		const archive = Buffer.alloc(indexSize + packed.length + 4);
		buildDirectory(
			[
				{
					name: "rle.txt",
					size: packed.length,
					offset: indexSize,
					method: 1,
				},
			],
			[{ name: "sub", offset: ROOT_OFFSET + ROOT_SIZE }],
			"root",
		).copy(archive, ROOT_OFFSET);
		buildDirectory(
			[
				{
					name: "child.tga",
					size: 4,
					offset: indexSize + packed.length,
					method: 0,
				},
			],
			[],
		).copy(archive, ROOT_OFFSET + ROOT_SIZE);
		archive.writeUInt32LE(indexSize, 0);
		packed.copy(archive, indexSize);
		await expectArchive({
			format: adsPacFormat,
			archive,
			sourcePath: "sample.pac",
			entries: [
				{
					path: "rle.txt",
					size: packed.length,
					content: Buffer.from("ABCABCABC"),
				},
				{ path: "sub/child.tga", size: 4, content: Buffer.alloc(4) },
			],
		});
	});

	it("requires the pac extension", async () => {
		const archive = Buffer.alloc(0x200);
		archive.writeUInt32LE(0x110, 0);
		await expectArchive({
			format: adsPacFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects an index size outside the file", async () => {
		const archive = Buffer.alloc(0x200);
		archive.writeUInt32LE(0x400, 0);
		await expectArchive({
			format: adsPacFormat,
			archive,
			sourcePath: "sample.pac",
			detected: false,
			entries: [],
		});
	});
});
