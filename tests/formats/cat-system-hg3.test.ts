import { hg3Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_SECTION_OFFSET = 0x0c;
const SECTION_HEADER_SIZE = 8;

/**
 * Builds a section: a size field, a `stdinfo` block whose own size follows at +0x10, and an optional
 * `img` chunk behind the block.
 */
function buildSection(info: Buffer, withImage: boolean): Buffer {
	const stdinfoSize = 12 + info.length;
	const body = Buffer.concat([
		Buffer.alloc(stdinfoSize),
		withImage ? Buffer.from("img", "ascii") : Buffer.alloc(0),
		Buffer.alloc(withImage ? 16 : 0, 0x33),
	]);
	const section = Buffer.concat([Buffer.alloc(SECTION_HEADER_SIZE), body]);
	section.writeUInt32LE(section.length, 0);
	section.write("stdinfo", SECTION_HEADER_SIZE, "ascii");
	section.writeUInt32LE(stdinfoSize, 0x10);
	info.copy(section, 0x14);
	return section;
}

function buildHg3(sections: readonly Buffer[]): Buffer {
	const archive = Buffer.concat([
		Buffer.alloc(FIRST_SECTION_OFFSET),
		...sections,
	]);
	archive.write("HG-3", 0, "ascii");
	return archive;
}

describe("CatSystem2 HG3 multi-image", () => {
	it("emits an entry for sections followed by an img chunk", async () => {
		const section = buildSection(Buffer.from("info"), true);
		const archive = buildHg3([section]);
		await expectArchive({
			format: hg3Format,
			archive,
			sourcePath: "graphic.hg3",
			entries: [
				{
					path: "graphic#0000",
					size: section.length - SECTION_HEADER_SIZE,
					content: archive.subarray(FIRST_SECTION_OFFSET + SECTION_HEADER_SIZE),
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("skips sections without an img chunk", async () => {
		const skipped = buildSection(Buffer.from("info"), false);
		const kept = buildSection(Buffer.from("info"), true);
		const archive = buildHg3([skipped, kept]);
		await expectArchive({
			format: hg3Format,
			archive,
			sourcePath: "graphic.hg3",
			entries: [
				{
					path: "graphic#0001",
					size: kept.length - SECTION_HEADER_SIZE,
					content: undefined,
				},
			],
			metadata: { entryCount: 1 },
		});
	});

	it("rejects a file whose first section is not stdinfo", async () => {
		const section = buildSection(Buffer.from("info"), true);
		section.write("stdinfx", SECTION_HEADER_SIZE, "ascii");
		await expectArchive({
			format: hg3Format,
			archive: buildHg3([section]),
			sourcePath: "graphic.hg3",
			detected: false,
			entries: [],
		});
	});
});
