import { FileByteSource } from "@garbro-mcp/core";
import { hedFormat, parseNameMap } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import {
	expectCompanionArchive,
	withCompanionFiles,
} from "../helpers/companion.js";
import { describe, expect, it } from "vitest";

const INDEX_OFFSET = 8;

interface Entry {
	name: string;
	content: Buffer;
}

/**
 * The index is a `hed` magic, an entry count, then an offset and a size per entry. Its offsets address the
 * archive's own payload file, not the index, so they start at zero here.
 */
function buildIndex(entries: readonly Entry[], recordSize: number): Buffer {
	const index = Buffer.alloc(INDEX_OFFSET + recordSize * entries.length);
	index.writeUInt32LE(0x00646568, 0);
	index.writeInt32LE(entries.length, 4);
	let position = 0;
	for (const [id, entry] of entries.entries()) {
		const record = INDEX_OFFSET + id * recordSize;
		index.writeUInt32LE(position, record);
		index.writeUInt32LE(entry.content.length, record + 4);
		position += entry.content.length;
	}
	return index;
}

const MAP = [
	"//BG FILES = 1",
	"bg01.bmp",
	"//CHR FILES = 1",
	"chr01.bmp",
	"//VOICE FILES = 1",
	"v001.wav",
].join("\n");

describe("elf AV King resource archive", () => {
	it("reads a graphic archive through its companion index and name list", async () => {
		const first = Buffer.from("background body");
		const second = Buffer.from("character body");
		const entries = [
			{ name: "bg01.bmp", content: first },
			{ name: "chr01.bmp", content: second },
		];
		await withCompanionFiles(
			"cg.bin",
			{
				"cg.bin": Buffer.concat([first, second]),
				"cg.pak": buildIndex(entries, 8),
				"avking.map": MAP,
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: hedFormat,
					mainPath,
					entries: [
						{ path: "bg01.bmp", size: first.length, content: first },
						{ path: "chr01.bmp", size: second.length, content: second },
					],
				});
			},
		);
	});

	it("reads a voice archive with its wider records", async () => {
		const content = Buffer.from("voice body");
		const entries = [{ name: "v001.wav", content }];
		await withCompanionFiles(
			"voice.bin",
			{
				"voice.bin": content,
				"voice.pak": buildIndex(entries, 0x18),
				"avking.map": MAP,
			},
			async (mainPath) => {
				await expectCompanionArchive({
					format: hedFormat,
					mainPath,
					entries: [{ path: "v001.wav", size: content.length, content }],
				});
			},
		);
	});

	it("rejects a count that disagrees with the name list", async () => {
		const content = Buffer.from("body");
		const entries = [{ name: "bg01.bmp", content }];
		const index = buildIndex(entries, 8);
		index.writeInt32LE(3, 4);
		await withCompanionFiles(
			"cg.bin",
			{ "cg.bin": content, "cg.pak": index, "avking.map": MAP },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await hedFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an index without the hed magic", async () => {
		const content = Buffer.from("body");
		const entries = [{ name: "bg01.bmp", content }];
		const index = buildIndex(entries, 8);
		index.writeUInt32LE(0x00646567, 0);
		await withCompanionFiles(
			"cg.bin",
			{ "cg.bin": content, "cg.pak": index, "avking.map": MAP },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await hedFormat.detect(source, mainPath)).toBe(false);
				await source.close();
			},
		);
	});

	it("rejects an archive whose name has no map section", async () => {
		const content = Buffer.from("body");
		await expectArchive({
			format: hedFormat,
			archive: content,
			sourcePath: "other.bin",
			detected: false,
			entries: [],
		});
	});

	it("consumes the names of unknown map blocks", () => {
		const parsed = parseNameMap(
			[
				"//BG FILES = 1",
				"bg01.bmp",
				"//OTHER FILES = 2",
				"ignored one",
				"ignored two",
				"//VOICE FILES = 1",
				"v001.wav",
			].join("\n"),
		);
		expect(parsed).toEqual({ cg: ["bg01.bmp"], voice: ["v001.wav"] });
	});

	it("rejects a map line that is neither a header nor a name", () => {
		expect(
			parseNameMap("//BG FILES = 1\nbg01.bmp\nstray line\n"),
		).toBeUndefined();
	});
});
