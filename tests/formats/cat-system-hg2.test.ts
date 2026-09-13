import { hg2Format } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const FIRST_SECTION_OFFSET = 0x0c;
const SECTION_SIZE_OFFSET = 0x40;
const SECTION_SIZE = 0x60;

function buildHg2(sections: readonly Buffer[]): Buffer {
	const parts = sections.map((section) =>
		Buffer.concat([
			Buffer.alloc(SECTION_SIZE_OFFSET + 4),
			section,
			Buffer.alloc(SECTION_SIZE - SECTION_SIZE_OFFSET - 4 - section.length),
		]),
	);
	const archive = Buffer.concat([Buffer.alloc(FIRST_SECTION_OFFSET), ...parts]);
	archive.write("HG-2", 0, "ascii");
	archive.writeInt32LE(0x25, 8);
	for (const [id] of sections.entries())
		archive.writeUInt32LE(
			SECTION_SIZE,
			FIRST_SECTION_OFFSET + id * SECTION_SIZE + SECTION_SIZE_OFFSET,
		);
	return archive;
}

describe("CatSystem2 HG2 multi-image", () => {
	it("walks sections sized by their own header field", async () => {
		const archive = buildHg2([Buffer.from("first"), Buffer.from("second!")]);
		await expectArchive({
			format: hg2Format,
			archive,
			sourcePath: "graphic.hg2",
			entries: [
				{
					path: "graphic#0000",
					size: SECTION_SIZE,
					content: archive.subarray(
						FIRST_SECTION_OFFSET,
						FIRST_SECTION_OFFSET + SECTION_SIZE,
					),
				},
				{
					path: "graphic#0001",
					size: SECTION_SIZE,
					content: archive.subarray(
						FIRST_SECTION_OFFSET + SECTION_SIZE,
						FIRST_SECTION_OFFSET + SECTION_SIZE * 2,
					),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("closes the last section at the end of the file", async () => {
		const archive = buildHg2([Buffer.from("only")]);
		archive.writeUInt32LE(0, FIRST_SECTION_OFFSET + SECTION_SIZE_OFFSET);
		await expectArchive({
			format: hg2Format,
			archive,
			sourcePath: "graphic.hg2",
			entries: [
				{
					path: "graphic#0000",
					size: SECTION_SIZE,
					content: archive.subarray(FIRST_SECTION_OFFSET),
				},
			],
		});
	});

	it("rejects a missing marker", async () => {
		const archive = buildHg2([Buffer.from("x")]);
		archive.writeInt32LE(0x24, 8);
		await expectArchive({
			format: hg2Format,
			archive,
			sourcePath: "graphic.hg2",
			detected: false,
			entries: [],
		});
	});
});
