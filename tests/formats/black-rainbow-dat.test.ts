import { encodeCp932 } from "@garbro-mcp/core";
import { blackRainbowDatFormat } from "@garbro-mcp/formats";
import { expectArchive } from "../helpers/archive.js";
import { describe, it } from "vitest";

const INDEX_OFFSET = 0x10;
const NAME_SIZE = 0x24;

interface DatEntry {
	name: string;
	content: Buffer;
	/** Skips the name field so the generated-name path is exercised. */
	anonymous?: boolean;
}

function buildDat(
	entries: readonly DatEntry[],
	indexValues?: readonly number[],
): Buffer {
	const records = entries.map((entry) => {
		const header = Buffer.alloc(NAME_SIZE);
		if (!entry.anonymous) encodeCp932(entry.name).copy(header, 0);
		// An anonymous record stores its `_BMD` marker at the start of the payload instead.
		return Buffer.concat([
			header,
			entry.anonymous ? Buffer.from("_BMD", "ascii") : Buffer.alloc(0),
			entry.content,
		]);
	});
	const slots =
		indexValues ??
		records.map((_, id) =>
			records.slice(0, id).reduce((sum, record) => sum + record.length, 0),
		);
	const baseOffset = INDEX_OFFSET + slots.length * 4;
	const archive = Buffer.concat([Buffer.alloc(baseOffset), ...records]);
	archive.writeInt32LE(slots.length, 8);
	archive.writeUInt32LE(baseOffset, 0x0c);
	for (const [id, value] of slots.entries())
		archive.writeUInt32LE(value, INDEX_OFFSET + id * 4);
	return archive;
}

describe("BlackRainbow DAT archive", () => {
	it("sorts relative offsets and reads names from the data", async () => {
		const first = buildDat([
			{ name: "data/one.bin", content: Buffer.from("first") },
			{ name: "two.bin", content: Buffer.from("second") },
		]);
		await expectArchive({
			format: blackRainbowDatFormat,
			archive: first,
			sourcePath: "sample.dat",
			entries: [
				{
					path: "data/one.bin",
					size: 5,
					content: Buffer.from("first"),
				},
				{ path: "two.bin", size: 6, content: Buffer.from("second") },
			],
			metadata: { entryCount: 2 },
		});
	});

	it("skips 0xffffffff offsets and generates names for anonymous entries", async () => {
		// Three index slots: the middle one is dropped, and the third points at the second record.
		const archive = buildDat(
			[
				{ name: "kept.bin", content: Buffer.from("kept") },
				{ name: "anonymous", content: Buffer.from("anon"), anonymous: true },
			],
			[0, 0xffffffff, NAME_SIZE + 4],
		);
		await expectArchive({
			format: blackRainbowDatFormat,
			archive,
			sourcePath: "sample.pak",
			entries: [
				{ path: "kept.bin", size: 4, content: Buffer.from("kept") },
				{
					path: "01_sample#01.bmd",
					size: 8,
					content: Buffer.from("_BMDanon"),
				},
			],
			metadata: { entryCount: 2 },
		});
	});

	it("rejects a base offset inside the index", async () => {
		const archive = buildDat([{ name: "a.bin", content: Buffer.from("a") }]);
		archive.writeUInt32LE(0x10, 0x0c);
		await expectArchive({
			format: blackRainbowDatFormat,
			archive,
			sourcePath: "sample.dat",
			detected: false,
			entries: [],
		});
	});
});
