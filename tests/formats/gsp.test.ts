import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { GspFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function buildGsp(): { archive: Buffer; contents: Buffer[] } {
	const definitions = [
		{ name: "背景.bmz", content: Buffer.from("ZLC3 synthetic image") },
		{ name: "voice.ogg", content: Buffer.from("OggS synthetic audio") },
	];
	const dataFloor = 4 + definitions.length * 0x40;
	const archive = Buffer.alloc(
		dataFloor +
			definitions.reduce((total, { content }) => total + content.length, 0),
	);
	archive.writeUInt32LE(definitions.length, 0);
	let dataOffset = dataFloor;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 4 + index * 0x40;
		archive.writeUInt32LE(dataOffset, recordOffset);
		archive.writeUInt32LE(definition.content.length, recordOffset + 4);
		encodeCp932(definition.name).copy(archive, recordOffset + 8, 0, 0x38);
		definition.content.copy(archive, dataOffset);
		dataOffset += definition.content.length;
	}
	return { archive, contents: definitions.map(({ content }) => content) };
}

describe("Black Rainbow GSP", () => {
	it("detects the structural index and extracts CP932-named entries", async () => {
		const fixture = buildGsp();
		const format = new GspFormat();
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "sample.gsp");
		try {
			expect(archive.entries).toMatchObject([
				{ id: "0", path: "背景.bmz" },
				{ id: "1", path: "voice.ogg" },
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

	it("rejects an entry placed inside the index", async () => {
		const fixture = buildGsp().archive;
		fixture.writeUInt32LE(4, 4);
		await expect(
			new GspFormat().open(new BufferByteSource(fixture), "broken.gsp"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
