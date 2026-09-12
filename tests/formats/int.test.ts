import {
	BufferByteSource,
	encodeCp932,
	type GarbroError,
} from "@garbro-mcp/core";
import { IntFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function buildInt(nameSize: 0x20 | 0x40): {
	archive: Buffer;
	contents: Buffer[];
} {
	const definitions = [
		{ name: "script.cst", content: Buffer.from("CatScene") },
		{ name: "画像.hg3", content: Buffer.from("HG-3 synthetic") },
	];
	const recordSize = nameSize + 8;
	const dataFloor = 8 + definitions.length * recordSize;
	const archive = Buffer.alloc(
		dataFloor +
			definitions.reduce((total, { content }) => total + content.length, 0),
	);
	archive.write("KIF\0", 0, "binary");
	archive.writeUInt32LE(definitions.length, 4);
	let dataOffset = dataFloor;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 8 + index * recordSize;
		encodeCp932(definition.name).copy(archive, recordOffset, 0, nameSize);
		archive.writeUInt32LE(dataOffset, recordOffset + nameSize);
		archive.writeUInt32LE(
			definition.content.length,
			recordOffset + nameSize + 4,
		);
		definition.content.copy(archive, dataOffset);
		dataOffset += definition.content.length;
	}
	return { archive, contents: definitions.map(({ content }) => content) };
}

describe("CatSystem2 INT", () => {
	for (const nameSize of [0x20, 0x40] as const) {
		it(`reads the ${nameSize}-byte CP932 filename layout`, async () => {
			const fixture = buildInt(nameSize);
			const archive = await new IntFormat().open(
				new BufferByteSource(fixture.archive),
				"sample.int",
			);
			try {
				expect(archive.metadata).toEqual({ nameSize });
				expect(archive.entries).toMatchObject([
					{ path: "script.cst" },
					{ path: "画像.hg3" },
				]);
				for (const [index, entry] of archive.entries.entries()) {
					expect(
						await consumeBuffer(await archive.openEntry(entry.id)),
					).toEqual(fixture.contents[index]);
				}
			} finally {
				await archive.close();
			}
		});
	}

	it("identifies encrypted indexes without parsing them as plain records", async () => {
		const fixture = Buffer.alloc(0x50);
		fixture.write("KIF\0", 0, "binary");
		fixture.writeUInt32LE(2, 4);
		fixture.write("__key__.dat\0", 8, "binary");
		const format = new IntFormat();
		expect(await format.detect(new BufferByteSource(fixture))).toBe(true);
		await expect(
			format.open(new BufferByteSource(fixture), "encrypted.int"),
		).rejects.toMatchObject<Partial<GarbroError>>({
			code: "UNSUPPORTED_FEATURE",
		});
	});
});
