import { BufferByteSource, encodeCp932, GarbroError } from "@garbro-mcp/core";
import { MajiroArcFormat } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function buildMajiro(version: 1 | 2 | 3): {
	archive: Buffer;
	contents: Buffer[];
} {
	const definitions = [
		{ name: "scenario.mjo", content: Buffer.from("Majiro script") },
		{ name: "画像.rct", content: Buffer.from("Majiro image") },
	];
	const names = Buffer.concat(
		definitions.map(({ name }) =>
			Buffer.concat([encodeCp932(name), Buffer.from([0])]),
		),
	);
	const recordSize = 4 * (version + 1);
	const recordCount = definitions.length + (version === 1 ? 1 : 0);
	const namesOffset = 0x1c + recordCount * recordSize;
	const dataOffset = namesOffset + names.length;
	const archive = Buffer.alloc(
		dataOffset +
			definitions.reduce((total, { content }) => total + content.length, 0),
	);
	archive.write(`MajiroArcV${version}.000\0`, 0, "binary");
	archive.writeUInt32LE(definitions.length, 16);
	archive.writeUInt32LE(namesOffset, 20);
	archive.writeUInt32LE(dataOffset, 24);
	let entryOffset = dataOffset;
	for (const [index, definition] of definitions.entries()) {
		const recordOffset = 0x1c + index * recordSize;
		if (version < 3) archive.writeUInt32LE(0x1000 + index, recordOffset);
		else archive.writeBigUInt64LE(0x100000000n + BigInt(index), recordOffset);
		const hashSize = version < 3 ? 4 : 8;
		archive.writeUInt32LE(entryOffset, recordOffset + hashSize);
		if (version > 1) {
			archive.writeUInt32LE(
				definition.content.length,
				recordOffset + hashSize + 4,
			);
		}
		definition.content.copy(archive, entryOffset);
		entryOffset += definition.content.length;
	}
	if (version === 1) {
		const sentinelOffset = 0x1c + definitions.length * recordSize;
		archive.writeUInt32LE(entryOffset, sentinelOffset + 4);
	}
	names.copy(archive, namesOffset);
	return { archive, contents: definitions.map(({ content }) => content) };
}

describe("Majiro ARC", () => {
	for (const version of [1, 2, 3] as const) {
		it(`reads MajiroArcV${version}.000 indexes`, async () => {
			const fixture = buildMajiro(version);
			const format = new MajiroArcFormat();
			const source = new BufferByteSource(fixture.archive);
			expect(await format.detect(source)).toBe(true);
			const archive = await format.open(source, "sample.arc");
			try {
				expect(archive.metadata).toEqual({ version });
				expect(archive.entries).toMatchObject([
					{ path: "scenario.mjo", size: 13n },
					{ path: "画像.rct", size: 12n },
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

	it("rejects a data offset before the names section", async () => {
		const fixture = buildMajiro(2).archive;
		fixture.writeUInt32LE(0x20, 24);
		await expect(
			new MajiroArcFormat().open(new BufferByteSource(fixture), "broken.arc"),
		).rejects.toBeInstanceOf(GarbroError);
	});
});
