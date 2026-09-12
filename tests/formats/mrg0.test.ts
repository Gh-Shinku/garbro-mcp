import { BufferByteSource, encodeCp932 } from "@garbro-mcp/core";
import { mrg0Format } from "@garbro-mcp/formats";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";

function buildMrg0(entries: { name: string; content: Buffer }[]): {
	archive: Buffer;
	dataOffset: number;
} {
	const indexSize = entries.length * 0x4c;
	const dataOffset = 0x10 + indexSize;
	const total =
		dataOffset + entries.reduce((sum, entry) => sum + entry.content.length, 0);
	const archive = Buffer.alloc(total);
	archive.write("mrg0", 0, "ascii");
	archive.writeInt32LE(entries.length, 4);
	archive.writeUInt32LE(dataOffset, 8);
	let offset = dataOffset;
	for (const [id, entry] of entries.entries()) {
		const recordOffset = 0x10 + id * 0x4c;
		encodeCp932(entry.name).copy(archive, recordOffset);
		archive.writeUInt32LE(entry.content.length, recordOffset + 0x40);
		entry.content.copy(archive, offset);
		offset += entry.content.length;
	}
	return { archive, dataOffset };
}

describe("F&C MRG0 archive", () => {
	it("reads a sequential index with CP932 names", async () => {
		const fixture = buildMrg0([
			{ name: "scenario.ks", content: Buffer.from("script body") },
			{ name: "画像\\背景.grd", content: Buffer.from("image body") },
		]);
		const source = new BufferByteSource(fixture.archive);
		expect(await mrg0Format.detect(source)).toBe(true);
		const archive = await mrg0Format.open(source, "sample.mrg");
		try {
			expect(archive.metadata).toEqual({ entryCount: 2 });
			expect(archive.entries).toMatchObject([
				{
					id: "0",
					path: "scenario.ks",
					size: 11n,
					offset: BigInt(fixture.dataOffset),
				},
				{
					id: "1",
					path: "画像/背景.grd",
					rawPath: "画像\\背景.grd",
					size: 10n,
				},
			]);
			const contents = [Buffer.from("script body"), Buffer.from("image body")];
			for (const [index, entry] of archive.entries.entries()) {
				expect(await consumeBuffer(await archive.openEntry(entry.id))).toEqual(
					contents[index],
				);
			}
		} finally {
			await archive.close();
		}
	});

	it("rejects a count whose index does not fit", async () => {
		const fixture = buildMrg0([{ name: "a.bin", content: Buffer.from("a") }]);
		fixture.archive.writeInt32LE(0x1000, 4);
		const format = mrg0Format;
		expect(await format.detect(new BufferByteSource(fixture.archive))).toBe(
			false,
		);
	});

	it("rejects an entry that points past the end of the archive", async () => {
		const fixture = buildMrg0([
			{ name: "a.bin", content: Buffer.from("a") },
			{ name: "b.bin", content: Buffer.from("b") },
		]);
		fixture.archive.writeUInt32LE(0x1000, 0x10 + 0x40);
		await expect(
			mrg0Format.open(new BufferByteSource(fixture.archive), "broken.mrg"),
		).rejects.toThrow(/outside the archive/);
	});
});
