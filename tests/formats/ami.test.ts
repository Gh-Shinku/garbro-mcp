import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { AmiFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { describe, expect, it } from "vitest";

function buildAmi(): { archive: Buffer; contents: Buffer[] } {
	const definitions = [
		{ id: 1, content: Buffer.from("SCR\0script payload"), compress: false },
		{ id: 0xabc, content: Buffer.from("GRP\0image payload"), compress: false },
		{
			id: 0xffffffff,
			content: Buffer.from("GRP\0compressed image payload"),
			compress: true,
		},
		{
			id: 0x12345678,
			content: Buffer.from("untyped data payload"),
			compress: false,
		},
	];
	const stored = definitions.map(({ content, compress }) =>
		compress ? deflateSync(content) : content,
	);
	const baseOffset = 16 + definitions.length * 16;
	const archive = Buffer.alloc(
		baseOffset + stored.reduce((total, data) => total + data.length, 0),
	);
	archive.write("AMI\0", 0, "binary");
	archive.writeUInt32LE(definitions.length, 4);
	archive.writeUInt32LE(baseOffset, 8);
	let dataOffset = baseOffset;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 16 + index * 16;
		const packed = stored[index];
		if (!packed) throw new Error("AMI fixture data is missing");
		archive.writeUInt32LE(definition.id, recordOffset);
		archive.writeUInt32LE(dataOffset, recordOffset + 4);
		archive.writeUInt32LE(definition.content.length, recordOffset + 8);
		archive.writeUInt32LE(
			definition.compress ? packed.length : 0,
			recordOffset + 12,
		);
		packed.copy(archive, dataOffset);
		dataOffset += packed.length;
	}
	return { archive, contents: definitions.map(({ content }) => content) };
}

describe("Amaterasu AMI", () => {
	it("infers entry extensions and inflates packed GRP data", async () => {
		const fixture = buildAmi();
		const format = new AmiFormat();
		const source = new BufferByteSource(fixture.archive);
		expect(await format.detect(source)).toBe(true);
		const archive = await format.open(source, "data.ami");
		try {
			expect(archive.entries).toMatchObject([
				{ id: "00000001", path: "00000001.scr", compressed: false },
				{ id: "00000abc", path: "00000abc.grp", compressed: false },
				{ id: "ffffffff", path: "ffffffff.grp", compressed: true },
				{ id: "12345678", path: "12345678.dat", compressed: false },
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

	it("rejects an entry that extends past the archive", async () => {
		const fixture = buildAmi().archive;
		fixture.writeUInt32LE(fixture.length, 16 + 4);
		await expect(
			new AmiFormat().open(new BufferByteSource(fixture), "broken.ami"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
