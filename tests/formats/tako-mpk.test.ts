import { FileByteSource } from "@garbro-mcp/core";
import { mpkHgFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 8;
const LIST_KEY = 0x0a;

/** Encrypts a file list the way GARbro reads it: XOR 0x0a over CP932 lines. */
function buildList(names: readonly string[]): Buffer {
	const text = Buffer.from(`${names.join("\r\n")}\r\n`, "latin1");
	for (let position = 0; position < text.length; position += 1)
		text[position] = (text[position] ?? 0) ^ LIST_KEY;
	return text;
}

interface MpkEntry {
	name: string;
	content: Buffer;
}

/** Builds the `HG-W` variant, which stores a size per record. */
function buildMpkW(entries: readonly MpkEntry[]): Buffer {
	const count = entries.length;
	const dataOffset = INDEX_OFFSET + count * 8;
	const archive = Buffer.alloc(
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0),
	);
	archive.write("HG-W", 0, "ascii");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * 8;
		archive.writeUInt32LE(offset, record);
		archive.writeUInt32LE(entry.content.length, record + 4);
		entry.content.copy(archive, position);
		offset += entry.content.length;
		position += entry.content.length;
	}
	return archive;
}

/** Builds the `HG-P` variant, which stores offsets only. */
function buildMpkP(contents: readonly Buffer[]): Buffer {
	const count = contents.length;
	const dataOffset = INDEX_OFFSET + count * 4;
	const archive = Buffer.alloc(
		dataOffset + contents.reduce((sum, content) => sum + content.length, 0),
	);
	archive.write("HG-P", 0, "ascii");
	archive.writeInt32LE(count, 4);
	let offset = dataOffset;
	let position = dataOffset;
	for (const [id, content] of contents.entries()) {
		archive.writeUInt32LE(offset, INDEX_OFFSET + id * 4);
		content.copy(archive, position);
		offset += content.length;
		position += content.length;
	}
	return archive;
}

describe("Studio Tako MPK resource archive", () => {
	it("reads the HG-W variant with a companion list", async () => {
		const entries = [
			{ name: "one.bin", content: Buffer.from("first payload") },
			{ name: "two.bin", content: Buffer.from("second") },
		];
		await withCompanionFiles(
			"sample.mpk",
			{
				"sample.mpk": buildMpkW(entries),
				"00.mpk": buildList(entries.map((entry) => entry.name)),
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: mpkHgFormat,
					mainPath,
					entries: entries.map((entry) => ({
						path: entry.name,
						size: entry.content.length,
						content: entry.content,
					})),
					metadata: { entryCount: 2 },
				});
			},
		);
	});

	it("derives sizes for the HG-P variant and generates names", async () => {
		const first = Buffer.from("first");
		const second = Buffer.from("second!");
		await expectArchive({
			format: mpkHgFormat,
			archive: buildMpkP([first, second]),
			sourcePath: "sample.mpk",
			entries: [
				{ path: "sample#0000", size: first.length, content: first },
				{ path: "sample#0001", size: second.length, content: second },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects the list file itself", async () => {
		await withCompanionFiles(
			"00.mpk",
			{ "00.mpk": buildMpkW([{ name: "a.bin", content: Buffer.from("x") }]) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				try {
					expect(await mpkHgFormat.detect(source, mainPath)).toBe(false);
				} finally {
					await source.close();
				}
			},
		);
	});
});
