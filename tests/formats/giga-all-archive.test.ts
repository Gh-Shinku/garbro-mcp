// The resource archives of the engine of Giga (GARbro "Legacy/Giga/ArcALL.cs", class AllOpener), against
// files built in the test: the table of the files of every archive stands in the reference itself, and the
// places of a file of an archive stand of the walk of the places of the engine.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import {
	GIGA_FILE_MAP,
	gigaAllEntries,
	gigaAllFormat,
	unpackGigaLzss,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";

/** The places of a file of the engine, of the counts of the walk of the reference. */
function literalStream(literals: Buffer): Buffer {
	// The count of the bits of the walk of the engine stands of the count of the places of the file, and
	// every place of the count behind it stands of eight counts of the places of the file: the count of the
	// places of a control place of the file stands of `bits >> 3` of them, and the counts behind them of
	// `bits & 7` of them.
	const bits = literals.length;
	const control: number[] = [];
	for (let at = 0; at < bits >> 3; at += 1) control.push(0xff);
	if (0 !== (bits & 7)) control.push((1 << (bits & 7)) - 1);
	const head = Buffer.alloc(4, 0x00);
	head.writeInt32LE(bits, 0);
	return Buffer.concat([head, Buffer.from(control), literals]);
}

describe("Giga engine resource archive", () => {
	it("reads the table of the files of the engine, of the reference", () => {
		expect(Object.keys(GIGA_FILE_MAP)).toEqual([
			"ALLCHP.273",
			"ALLGRP.273",
			"ALLXXX.273",
			"ALLMAP.273",
			"ALLMCP.273",
		]);
		expect(Object.values(GIGA_FILE_MAP).map((table) => table.length)).toEqual([
			199, 339, 366, 784, 260,
		]);
		// The first three files of the first archive, as they stand in `ArcALL.cs` itself.
		expect(GIGA_FILE_MAP["ALLCHP.273"]?.slice(0, 3)).toEqual([
			["ankei_a.chp", "image", 0, 0xc436, 0x13c5, true],
			["ankei_b.chp", "image", 0x13c5, 0x8436, 0x108c, true],
			["ankei_c.chp", "image", 0x2451, 0xc436, 0x136c, true],
		]);
		// The name of the archive stands of the table alone, of no count of the places of the file.
		expect(gigaAllEntries("/tmp/ALLCHP.273")?.length).toBe(199);
		expect(gigaAllEntries("/tmp/allchp.273")?.length).toBe(199);
		expect(gigaAllEntries("/tmp/other.273")).toBeUndefined();
	});

	it("reads the places of a file of the engine, of the places of the walk of it", () => {
		// A walk of no count of the counts of the places of the file stands of the places as they stand.
		const raw = Buffer.concat([
			Buffer.alloc(4, 0x00),
			Buffer.from([1, 2, 3, 4, 5, 6, 7, 8]),
		]);
		expect([...(unpackGigaLzss(raw, 8) ?? Buffer.alloc(0))]).toEqual([
			1, 2, 3, 4, 5, 6, 7, 8,
		]);
		// A walk of eight counts of the places of the file: one place of the counts of them stands of
		// eight places of the file itself.
		const literals = Buffer.from([
			0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22,
		]);
		const walked = unpackGigaLzss(literalStream(literals), 8);
		expect([...(walked ?? Buffer.alloc(0))]).toEqual([...literals]);
		// A walk of a place of the file that stands of a place of the walk of the engine, worked out here
		// by hand: the walk stands of nine counts of the places of the file, of eight of them and of one,
		// and the one stands of the counts `0x2007`, of the counts of the places of the walk of the engine
		// `7` places in front of the place of the file itself (`offset = 8 - 7 - 1 = 0`) and of four places
		// of the file (`(0x2007 >> 12) + 2 = 4`).
		const copy = Buffer.concat([
			Buffer.alloc(4, 0x00),
			Buffer.from([0xff]),
			Buffer.from([0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22]),
			Buffer.from([0x00]),
			Buffer.from([0x07, 0x20]),
		]);
		copy.writeInt32LE(9, 0);
		expect([...(unpackGigaLzss(copy, 12) ?? Buffer.alloc(0))]).toEqual([
			0xaa, 0xbb, 0xcc, 0xdd, 0xee, 0xff, 0x11, 0x22, 0xaa, 0xbb, 0xcc, 0xdd,
		]);
	});

	it("reads the files of an archive of the engine, of the places of the walk of it", async () => {
		// The archive of the engine of the third file of the table stands of a count of the places of the
		// file of its own; a file of the places of the walk of the engine that stands of no count of them
		// stands of the places of the file as they stand, and a file that stands of counts stands refused
		// where the counts of it stand past the places of the file.
		const file = Buffer.alloc(0x103c31, 0x00);
		const source = new BufferByteSource(file);
		expect(await gigaAllFormat.detect(source, "/tmp/ALLXXX.273")).toBe(true);
		const handle = await gigaAllFormat.open(source, "/tmp/ALLXXX.273");
		try {
			expect(handle.entries.length).toBe(366);
			expect(handle.entries[0]?.path).toBe("b_abel.spt");
			expect(handle.entries[0]?.compressed).toBe(true);
			await expect(
				handle.openEntry(handle.entries[0]?.id ?? "0"),
			).rejects.toThrow();
			// A file of the archive whose places stand of no count of the walk of the engine (the count
			// of the places of the walk of it at the head of the file stands at nought) stands of the
			// places of the file as they stand: `retry.cod` stands of 78 places of a file of 82.
			expect(handle.entries[127]?.path).toBe("retry.cod");
			expect(handle.entries[127]?.metadata?.unpackedSize).toBe(78);
			const raw = await consumeBuffer(
				await handle.openEntry(handle.entries[127]?.id ?? "127"),
			);
			expect(raw.length).toBe(78);
		} finally {
			await handle.close();
		}
		// A file of another name stands of no archive of this engine.
		const other = new BufferByteSource(Buffer.alloc(0x100, 0x00));
		expect(await gigaAllFormat.detect(other, "/tmp/other.273")).toBe(false);
	});
});
