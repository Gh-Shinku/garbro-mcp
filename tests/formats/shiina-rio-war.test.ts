// The resource archives of the engine of Shiina Rio of the count of the version one hundred and ten (GARbro
// "ArcFormats/ShiinaRio/ArcWARC.cs", class WarOpener), against files built in the test: the index of such an
// archive stands of a count of the file exclusive-or'ed over every word of it and of nothing else.
import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { decryptWarIndex, readWarHeader, warFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { buffer as consumeBuffer } from "node:stream/consumers";

const INDEX_KEY = 0xf182ad82;
const INDEX_AT = 0x40;
const RECORD_PLACES = 0x28;

/** An archive of the count of the version given, of the files named. */
function warFile(
	digit: string,
	files: { name: string; content: Buffer; unpacked?: number; flags?: number }[],
	indexAt = INDEX_AT,
): Buffer {
	const records = Buffer.alloc(
		files.length * RECORD_PLACES + RECORD_PLACES,
		0x00,
	);
	let dataAt = indexAt + records.length;
	const parts: Buffer[] = [];
	for (const [id, file] of files.entries()) {
		const at = id * RECORD_PLACES;
		records.write(file.name, at, "latin1");
		records.writeUInt32LE(dataAt, at + 0x10);
		records.writeUInt32LE(file.content.length, at + 0x14);
		records.writeUInt32LE(file.unpacked ?? file.content.length, at + 0x18);
		records.writeBigInt64LE(0x1234n, at + 0x1c);
		records.writeUInt32LE(file.flags ?? 0, at + 0x24);
		parts.push(file.content);
		dataAt += file.content.length;
	}
	decryptWarIndex(records, indexAt);
	const head = Buffer.alloc(indexAt, 0x00);
	head.write("WARC", 0, "latin1");
	head.write(` 1.${digit}`, 4, "latin1");
	head.writeUInt32LE((INDEX_KEY ^ indexAt) >>> 0, 8);
	return Buffer.concat([head, records, ...parts]);
}

const FILE = Buffer.from("places of a file", "latin1");

describe("Shiina Rio engine resource archive of the count one hundred and ten", () => {
	it("reads the count of the places of the index of the file, of the head of it", () => {
		expect(readWarHeader(warFile("1", []))).toEqual({
			version: 110,
			indexOffset: INDEX_AT,
		});
		// The count of the version stands at the fourth place of the file, and only the counts of one
		// hundred and ten and below stand of this port at all.
		expect(readWarHeader(warFile("2", []))).toBeUndefined();
		expect(readWarHeader(warFile("0", []))).toBeUndefined();
		const wrong = warFile("1", []);
		wrong.write("WARC 2.1", 0, "latin1");
		expect(readWarHeader(wrong)).toBeUndefined();
		// Every word of the index stands of the count of the places of the file of it.
		const index = Buffer.alloc(8, 0x00);
		decryptWarIndex(index, 0x40);
		expect([...index]).toEqual([
			0x40, 0x00, 0x00, 0x00, 0x40, 0x00, 0x00, 0x00,
		]);
	});

	it("reads the files of an archive of the engine, of the count of the version of it", async () => {
		const file = warFile("1", [
			{ name: "first.txt", content: FILE },
			{ name: "second.bin", content: FILE, unpacked: 0x40, flags: 0x80000000 },
		]);
		const source = new BufferByteSource(file);
		expect(await warFormat.detect(source, "/tmp/sample.warc")).toBe(true);
		const handle = await warFormat.open(source, "/tmp/sample.warc");
		try {
			// A record of no name stands of no file of the listing.
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"first.txt",
				"second.bin",
			]);
			expect(handle.entries.map((entry) => entry.size)).toEqual([
				BigInt(FILE.length),
				BigInt(FILE.length),
			]);
			expect(handle.entries.map((entry) => entry.compressed)).toEqual([
				false,
				true,
			]);
			expect(handle.entries[1]?.metadata?.unpackedSize).toBe("64");
			expect(handle.entries[1]?.metadata?.flags).toBe(0x80000000);
			expect(handle.metadata?.version).toBe(110);
			// The places of a file of the count one hundred and ten stand as they stand.
			const places = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? "0"),
			);
			expect(places.equals(FILE)).toBe(true);
		} finally {
			await handle.close();
		}
	});

	it("reads no archive of a head the engine stands of no count of, and of no index within it", async () => {
		const wrongHead = warFile("1", [{ name: "a.txt", content: FILE }]);
		wrongHead.write("WARC 1x1", 4, "latin1");
		expect(
			await warFormat.detect(new BufferByteSource(wrongHead), "/tmp/a.warc"),
		).toBe(false);
		// The places of the index stand within the file itself.
		const beyond = warFile("1", [], 0x1000);
		expect(
			await warFormat.detect(new BufferByteSource(beyond), "/tmp/b.warc"),
		).toBe(false);
		// A file of the engine stands within the file of the archive: the place of the first file of the
		// index stands at the place of it, the count of the places standing behind it.
		const outside = warFile("1", [{ name: "a.txt", content: FILE }]);
		outside.writeUInt32LE(0x7fffffff, INDEX_AT + 0x10);
		expect(
			await warFormat.detect(new BufferByteSource(outside), "/tmp/c.warc"),
		).toBe(false);
		// An index shorter than the count of the places of the reference stands of no archive.
		const short = Buffer.concat([
			warFile("1", []).subarray(0, INDEX_AT),
			Buffer.alloc(4, 0x00),
		]);
		expect(
			await warFormat.detect(new BufferByteSource(short), "/tmp/d.warc"),
		).toBe(false);
	});
});
