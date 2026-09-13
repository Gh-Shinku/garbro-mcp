import { encodeCp932 } from "@garbro-mcp/core";
import { dxFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const NAME_SIZE = 0x20;
const RECORD_SIZE = 0x28;
const ROOT_OFFSET = 8;

interface DxFile {
	name: string;
	content: Buffer;
}

interface DxDir {
	name: string;
	files: readonly DxFile[];
}

interface DirectoryLayout {
	offset: number;
	baseOffset: number;
}

/**
 * Builds the recursive index: directory records hold a nested index offset and the base offset added
 * to that directory's file offsets, followed by the file triplets.
 */
function buildIndex(dirs: readonly DxDir[]): {
	index: Buffer;
	entries: { path: string; content: Buffer; offset: number }[];
} {
	// Reserve space for the root directory records first.
	const rootOffset = ROOT_OFFSET;
	let cursor = rootOffset + 4 + dirs.length * RECORD_SIZE;
	const layout: DirectoryLayout[] = [];
	let dataCursor = 0;
	for (const dir of dirs) {
		layout.push({ offset: cursor, baseOffset: dataCursor });
		// A leaf directory still starts with a zero directory-record count.
		cursor += 4 + 4 + dir.files.length * RECORD_SIZE;
		dataCursor += dir.files.reduce((sum, file) => sum + file.content.length, 0);
	}
	const indexLength = cursor;
	const index = Buffer.alloc(indexLength);
	index.writeInt32LE(dirs.length, rootOffset);
	const entries: { path: string; content: Buffer; offset: number }[] = [];
	for (const [id, dir] of dirs.entries()) {
		const layoutEntry = layout[id];
		if (!layoutEntry) continue;
		const record = rootOffset + 4 + id * RECORD_SIZE;
		encodeCp932(dir.name).copy(index, record);
		index.writeUInt32LE(layoutEntry.offset, record + NAME_SIZE);
		index.writeUInt32LE(layoutEntry.baseOffset, record + NAME_SIZE + 4);
		let position = layoutEntry.offset;
		index.writeInt32LE(0, position);
		position += 4;
		index.writeInt32LE(dir.files.length, position);
		position += 4;
		let relative = 0;
		for (const file of dir.files) {
			encodeCp932(file.name).copy(index, position);
			index.writeUInt32LE(relative, position + NAME_SIZE);
			index.writeUInt32LE(file.content.length, position + RECORD_SIZE - 4);
			entries.push({
				path: `${dir.name}/${file.name}`,
				content: file.content,
				offset: indexLength + layoutEntry.baseOffset + relative,
			});
			relative += file.content.length;
			position += RECORD_SIZE;
		}
	}
	return { index, entries };
}

function buildDx(dirs: readonly DxDir[]): Buffer {
	const { index, entries } = buildIndex(dirs);
	const payload = Buffer.concat(entries.map((entry) => entry.content));
	const archive = Buffer.concat([index, payload]);
	archive.write("PACK", 0, "ascii");
	archive.writeUInt32LE(index.length, 4);
	return archive;
}

describe("DX engine resource archive", () => {
	it("walks nested directories and inverts .hse entries", async () => {
		const first = Buffer.from("first payload");
		const inverted = Buffer.from("inverted body");
		const stored = Buffer.from(inverted);
		for (let position = 0; position < stored.length; position += 1)
			stored[position] = ~(stored[position] ?? 0) & 0xff;
		await expectArchive({
			format: dxFormat,
			archive: buildDx([
				{
					name: "data",
					files: [
						{ name: "one.bin", content: first },
						{ name: "two.hse", content: stored },
					],
				},
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "data/one.bin", size: first.length, content: first },
				{ path: "data/two.hse", size: inverted.length, content: inverted },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("reads several directories", async () => {
		const a = Buffer.from("payload a");
		const b = Buffer.from("payload b!");
		await expectArchive({
			format: dxFormat,
			archive: buildDx([
				{ name: "one", files: [{ name: "a.bin", content: a }] },
				{ name: "two", files: [{ name: "b.bin", content: b }] },
			]),
			sourcePath: "sample.pak",
			entries: [
				{ path: "one/a.bin", size: a.length, content: a },
				{ path: "two/b.bin", size: b.length, content: b },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("requires the pak extension", async () => {
		await expectArchive({
			format: dxFormat,
			archive: buildDx([
				{ name: "dir", files: [{ name: "a.bin", content: Buffer.from("x") }] },
			]),
			sourcePath: "sample.bin",
			detected: false,
			entries: [],
		});
	});

	it("rejects a nested index offset inside its own directory", async () => {
		const archive = buildDx([
			{ name: "dir", files: [{ name: "a.bin", content: Buffer.from("x") }] },
		]);
		// Point the nested index at the directory record itself.
		archive.writeUInt32LE(ROOT_OFFSET + 4, ROOT_OFFSET + 4 + NAME_SIZE);
		await expectArchive({
			format: dxFormat,
			archive,
			sourcePath: "sample.pak",
			detected: false,
			entries: [],
		});
	});
});
