import { encodeCp932 } from "@garbro-mcp/core";
import { maiFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x10;
const RECORD_SIZE = 0x18;
const FOLDER_SIZE = 8;

interface Entry {
	name: string;
	content: Buffer;
}

interface Folder {
	name: string;
	index: number;
}

/** Builds the head, the file records and the folder records, then the payloads. */
function buildMai(
	entries: readonly Entry[],
	folders: readonly Folder[],
): Buffer {
	const indexSize = entries.length * RECORD_SIZE + folders.length * FOLDER_SIZE;
	const dataOffset = HEADER_SIZE + indexSize;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.writeUInt32LE(0x0a49414d, 0);
	archive.writeUInt32LE(archive.length, 4);
	archive.writeInt32LE(entries.length, 8);
	archive.writeUInt8(folders.length === 0 ? 0 : 2, 0x0d);
	archive.writeUInt16LE(folders.length, 0x0e);
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = HEADER_SIZE + id * RECORD_SIZE;
		encodeCp932(entry.name).copy(archive, record);
		archive.writeUInt32LE(position, record + 0x10);
		archive.writeUInt32LE(entry.content.length, record + 0x14);
		entry.content.copy(archive, position);
		position += entry.content.length;
	}
	for (const [id, folder] of folders.entries()) {
		const record =
			HEADER_SIZE + entries.length * RECORD_SIZE + id * FOLDER_SIZE;
		encodeCp932(folder.name).copy(archive, record);
		archive.writeInt32LE(folder.index, record + 4);
	}
	return archive;
}

describe("MAI resource archive", () => {
	it("applies folder names from their own index onward", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		const third = Buffer.from("third body");
		await expectArchive({
			format: maiFormat,
			archive: buildMai(
				[
					{ name: "root.dat", content: first },
					{ name: "in.dat", content: second },
					{ name: "later.dat", content: third },
				],
				[{ name: "fold", index: 1 }],
			),
			sourcePath: "sample.arc",
			entries: [
				{ path: "root.dat", size: first.length, content: first },
				{ path: "fold/in.dat", size: second.length, content: second },
				{ path: "fold/later.dat", size: third.length, content: third },
			],
		});
	});

	it("reads an archive without folders", async () => {
		const content = Buffer.from("plain body");
		await expectArchive({
			format: maiFormat,
			archive: buildMai([{ name: "one.dat", content }], []),
			sourcePath: "sample.arc",
			entries: [{ path: "one.dat", size: content.length, content }],
		});
	});

	it("rejects a file size word that disagrees", async () => {
		const content = Buffer.from("body");
		const archive = buildMai([{ name: "one.dat", content }], []);
		archive.writeUInt32LE(archive.length + 4, 4);
		await expectArchive({
			format: maiFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects an empty entry count", async () => {
		const content = Buffer.from("body");
		const archive = buildMai([{ name: "one.dat", content }], []);
		archive.writeInt32LE(0, 8);
		await expectArchive({
			format: maiFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("requires the arc extension", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: maiFormat,
			archive: buildMai([{ name: "one.dat", content }], []),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
