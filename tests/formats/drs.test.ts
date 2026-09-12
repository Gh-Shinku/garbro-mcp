import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { DrsFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function buildDrs(): { archive: Buffer; contents: Buffer[] } {
	const definitions = [
		{ name: "script.snr", content: Buffer.from("scenario") },
		{ name: "画像.ggd", content: Buffer.from("graphics") },
	];
	const directorySize = (definitions.length + 1) * 0x10;
	const dataOffset = directorySize + 2;
	const archive = Buffer.alloc(
		dataOffset +
			definitions.reduce((total, { content }) => total + content.length, 0),
	);
	archive.writeUInt16LE(directorySize, 0);
	let offset = dataOffset;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 2 + index * 0x10;
		encodeCp932(definition.name).copy(archive, recordOffset, 0, 12);
		archive.writeUInt32LE(offset, recordOffset + 12);
		definition.content.copy(archive, offset);
		offset += definition.content.length;
	}
	archive.writeUInt32LE(offset, 2 + definitions.length * 0x10 + 12);
	return { archive, contents: definitions.map(({ content }) => content) };
}

describe("Digital Romance System DRS", () => {
	it("reads the sentinel-terminated CP932 index and extracts entries", async () => {
		const fixture = buildDrs();
		const format = new DrsFormat();
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.dat");
		try {
			expect(archive.entries).toMatchObject([
				{ id: "0", path: "script.snr", size: 8n },
				{ id: "1", path: "画像.ggd", size: 8n },
			]);
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					fixture.contents[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("rejects a descending sentinel offset", async () => {
		const fixture = buildDrs().archive;
		fixture.writeUInt32LE(0, 2 + 2 * 0x10 + 12);
		await expect(
			new DrsFormat().open(new BufferByteSource(fixture), "broken.dat"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
