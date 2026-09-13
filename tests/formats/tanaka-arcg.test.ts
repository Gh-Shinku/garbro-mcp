import { encodeCp932 } from "@garbro-mcp/core";
import { arcgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const HEADER_SIZE = 0x16;
const FILE_TAIL_SIZE = 8;

interface FileRecord {
	name: string;
	content: Buffer;
}

interface DirectoryRecord {
	name: string;
	files: readonly FileRecord[];
}

/** A name field is a length byte counting the terminator, the name and that terminator. */
function nameFieldLength(name: string): number {
	return encodeCp932(name).length + 2;
}

/**
 * Builds an archive whose index sits inside the file. Every directory record comes first and the file-record
 * blocks follow them, since the reference walks directory records with one cursor and reaches each directory's
 * files through an offset stored in its record. A stored name length counts the length byte, the name and its
 * terminator.
 */
function buildArcg(directories: readonly DirectoryRecord[]): {
	archive: Buffer;
	firstFileOffsetField: number;
} {
	const nameField = (name: string): number => encodeCp932(name).length + 2;
	const fileBlock = (directory: DirectoryRecord): number =>
		directory.files.reduce(
			(sum, file) => sum + nameField(file.name) + FILE_TAIL_SIZE,
			0,
		);
	const directoryBlocks = directories.map(
		(directory) => nameField(directory.name) + FILE_TAIL_SIZE,
	);
	const fileBlocks = directories.map(fileBlock);
	const directoryOffset = HEADER_SIZE;
	const indexSize =
		directoryBlocks.reduce((sum, size) => sum + size, 0) +
		fileBlocks.reduce((sum, size) => sum + size, 0);
	// Each directory's files begin where its own block starts within the index.
	const fileStarts: number[] = [];
	let cursor =
		directoryOffset + directoryBlocks.reduce((sum, size) => sum + size, 0);
	for (const [id, size] of fileBlocks.entries()) {
		fileStarts.push(cursor);
		cursor += size;
		void id;
	}
	const dataOffset = directoryOffset + indexSize;
	const archive = Buffer.alloc(
		dataOffset +
			directories.reduce(
				(sum, directory) =>
					sum +
					directory.files.reduce((sum2, file) => sum2 + file.content.length, 0),
				0,
			),
	);
	archive.write("ARCG", 0, "ascii");
	archive.writeUInt32LE(0x10000, 4);
	archive.writeInt32LE(directoryOffset, 8);
	archive.writeInt32LE(indexSize, 0x0c);
	archive.writeUInt16LE(directories.length, 0x10);
	archive.writeInt32LE(
		directories.reduce((sum, directory) => sum + directory.files.length, 0),
		0x12,
	);

	let position = directoryOffset;
	for (const [id, directory] of directories.entries()) {
		const name = encodeCp932(directory.name);
		archive.writeUInt8(name.length + 2, position);
		name.copy(archive, position + 1);
		position += name.length + 2;
		archive.writeInt32LE(fileStarts[id] ?? 0, position);
		archive.writeInt32LE(directory.files.length, position + 4);
		position += FILE_TAIL_SIZE;
	}

	const firstFileOffsetField =
		(fileStarts[0] ?? directoryOffset) +
		1 +
		(directories[0]?.files[0]?.name.length ?? 0) +
		1;
	let data = dataOffset;
	for (const directory of directories) {
		for (const file of directory.files) {
			const fileName = encodeCp932(file.name);
			archive.writeUInt8(fileName.length + 2, position);
			fileName.copy(archive, position + 1);
			position += fileName.length + 2;
			archive.writeUInt32LE(data, position);
			archive.writeUInt32LE(file.content.length, position + 4);
			position += FILE_TAIL_SIZE;
			file.content.copy(archive, data);
			data += file.content.length;
		}
	}
	return { archive, firstFileOffsetField };
}

describe("Tanaka ARCG resource archive", () => {
	it("walks directory records and their file lists", async () => {
		const first = Buffer.from("first body");
		const second = Buffer.from("second body");
		const { archive } = buildArcg([
			{ name: "graph", files: [{ name: "one.bmp", content: first }] },
			{ name: "sound", files: [{ name: "two.wav", content: second }] },
		]);
		await expectArchive({
			format: arcgFormat,
			archive,
			sourcePath: "sample.arc",
			entries: [
				{ path: "graph/one.bmp", size: first.length, content: first },
				{ path: "sound/two.wav", size: second.length, content: second },
			],
		});
	});

	it("replaces a half-width question mark with its full-width form", async () => {
		const content = Buffer.from("question body");
		const { archive } = buildArcg([
			{ name: "dir", files: [{ name: "what?.dat", content }] },
		]);
		await expectArchive({
			format: arcgFormat,
			archive,
			sourcePath: "sample.arc",
			entries: [{ path: "dir/what？.dat", size: content.length, content }],
		});
	});

	it("rejects a companion-index archive", async () => {
		// An index offset of zero means the index lives in a `.bmi` file behind a volume-bound key.
		const content = Buffer.from("body");
		const { archive } = buildArcg([
			{ name: "dir", files: [{ name: "one.dat", content }] },
		]);
		archive.writeInt32LE(0, 8);
		await expectArchive({
			format: arcgFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("rejects an entry whose payload leaves the file", async () => {
		const content = Buffer.from("body");
		const { archive, firstFileOffsetField } = buildArcg([
			{ name: "dir", files: [{ name: "one.dat", content }] },
		]);
		archive.writeUInt32LE(0x1000, firstFileOffsetField);
		await expectArchive({
			format: arcgFormat,
			archive,
			sourcePath: "sample.arc",
			detected: false,
			entries: [],
		});
	});

	it("requires a registered extension", async () => {
		const content = Buffer.from("body");
		const { archive } = buildArcg([
			{ name: "dir", files: [{ name: "one.dat", content }] },
		]);
		await expectArchive({
			format: arcgFormat,
			archive,
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});
});
