import { encodeCp932 } from "@garbro-mcp/core";
import { yaneSdaFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x14;
const DIR_RECORD_SIZE = 0x18;
const FILE_RECORD_SIZE = 0x30;

interface SdaDirectory {
	name: string;
	extension: string;
	files: readonly { name: string; content: Buffer }[];
}

function buildSda(directories: readonly SdaDirectory[]): Buffer {
	const fileRecords = directories.flatMap((directory) =>
		directory.files.map((file) => {
			const record = Buffer.alloc(FILE_RECORD_SIZE);
			encodeCp932(file.name).copy(record, 0);
			return { file, record };
		}),
	);
	const indexSize = INDEX_OFFSET + directories.length * DIR_RECORD_SIZE;
	const recordsSize = fileRecords.length * FILE_RECORD_SIZE;
	const dataOffset = indexSize + recordsSize;
	const archive = Buffer.alloc(
		dataOffset +
			directories.reduce(
				(sum, directory) =>
					sum +
					directory.files.reduce(
						(inner, file) => inner + file.content.length,
						0,
					),
				0,
			),
	);
	archive.write("SQDARC", 0, "ascii");
	archive.writeInt32LE(directories.length, 0x10);
	let recordOffset = indexSize;
	let position = dataOffset;
	let fileIndex = 0;
	for (const [id, directory] of directories.entries()) {
		const indexRecord = INDEX_OFFSET + id * DIR_RECORD_SIZE;
		archive.writeUInt32LE(recordOffset, indexRecord);
		archive.writeInt32LE(directory.files.length, indexRecord + 4);
		encodeCp932(directory.name).copy(archive, indexRecord + 8);
		encodeCp932(directory.extension).copy(archive, indexRecord + 0x12);
		for (const file of directory.files) {
			const entry = fileRecords[fileIndex];
			if (!entry) continue;
			entry.record.writeUInt32LE(file.content.length, 0x28);
			entry.record.writeUInt32LE(position, 0x2c);
			entry.record.copy(archive, recordOffset);
			file.content.copy(archive, position);
			recordOffset += FILE_RECORD_SIZE;
			position += file.content.length;
			fileIndex += 1;
		}
	}
	return archive;
}

describe("YaneSDK2 SDA resource archive", () => {
	it("walks directories and rewrites extensions", async () => {
		const script = Buffer.from("script body");
		const image = Buffer.from("image data!");
		await expectArchive({
			format: yaneSdaFormat,
			archive: buildSda([
				{
					name: "script",
					extension: "scr",
					files: [{ name: "start", content: script }],
				},
				{
					name: "graphic",
					extension: "gfx",
					files: [{ name: "title.old", content: image }],
				},
			]),
			sourcePath: "game.sda",
			entries: [
				{ path: "script/start.scr", size: script.length, content: script },
				{ path: "graphic/title.gfx", size: image.length, content: image },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a missing signature", async () => {
		const archive = buildSda([]);
		archive.write("SQDARP", 0, "ascii");
		await expectArchive({
			format: yaneSdaFormat,
			archive,
			sourcePath: "game.sda",
			detected: false,
			entries: [],
		});
	});

	it("rejects a directory count beyond the file", async () => {
		const archive = buildSda([
			{
				name: "a",
				extension: "bin",
				files: [{ name: "x", content: Buffer.from("x") }],
			},
		]);
		archive.writeInt32LE(0x1000, 0x10);
		await expectArchive({
			format: yaneSdaFormat,
			archive,
			sourcePath: "game.sda",
			detected: false,
			entries: [],
		});
	});
});
