// The AI5WIN engine resource archive (GARbro "ArcFormats/elf/ArcAi5Win.cs", class ArcAI5Opener), against
// archives built in the test. The count of a name and the ciphers of the names, of the counts and of the
// places of the pictures stand of no place of the file; the reference reads them out of the index itself
// where it holds no scheme for the game at hand, and so does this port.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { BufferByteSource } from "@garbro-mcp/core";
import { ai5WinFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";

interface FixtureEntry {
	name: string;
	data: Buffer;
	packed?: boolean;
}

interface FixtureInput {
	count?: number;
	nameLength: number;
	nameKey: number;
	sizeKey: number;
	offsetKey: number;
	entries: FixtureEntry[];
}

/**
 * An archive of the engine: the count of the pictures at 0, then the records of the index, and then the
 * places of the pictures themselves. A name stands of the places of the engine, exclusive-ored with the
 * cipher of the names and ended by a place of no name, which the cipher turns into the cipher's own place.
 */
function ai5File(input: FixtureInput): Buffer {
	const count = input.count ?? input.entries.length;
	const records: Buffer[] = [];
	const parts: Buffer[] = [];
	const dataOffset = 4 + count * (input.nameLength + 8);
	let offset = dataOffset;
	for (const entry of input.entries) {
		const name = Buffer.from(entry.name, "latin1");
		// The engine stands of the whole of the places of a name exclusive-ored, the places of no name
		// behind the name of it included: the reference reads the cipher of the names off the last place of
		// the field of a name, so that place stands of the cipher itself.
		const field = Buffer.alloc(input.nameLength, 0x00);
		for (let at = 0; at < name.length; at += 1) {
			field[at] = (name[at] ?? 0) ^ input.nameKey;
		}
		field[name.length] = input.nameKey; // the place of no name, exclusive-ored
		for (let at = name.length + 1; at < input.nameLength; at += 1) {
			field[at] = input.nameKey;
		}
		records.push(field);
		const size = Buffer.alloc(4);
		size.writeUInt32LE((entry.data.length ^ input.sizeKey) >>> 0, 0);
		const place = Buffer.alloc(4);
		place.writeUInt32LE((offset ^ input.offsetKey) >>> 0, 0);
		records.push(size, place);
		parts.push(entry.data);
		offset += entry.data.length;
	}
	const head = Buffer.alloc(4);
	head.writeInt32LE(count, 0);
	return Buffer.concat([head, ...records, ...parts]);
}

/** The LZSS walk of the engine over places that all stand on their own: a word of eight set places. */
function lzssLiterals(data: Buffer): Buffer {
	if (data.length !== 8) throw new Error("the fixture stands of eight places");
	return Buffer.concat([Buffer.from([0xff]), data]);
}

describe("AI5WIN engine resource archive", () => {
	it("reads the shape of the index out of the index itself", async () => {
		const first = Buffer.from("a picture of the engine", "latin1");
		const second = Buffer.from("another picture", "latin1");
		const file = ai5File({
			nameLength: 0x14,
			nameKey: 0x5a,
			sizeKey: 0x0f0f0f0f,
			offsetKey: 0x12345678,
			entries: [
				{ name: "first.bmp", data: first },
				{ name: "second.mes", data: second },
			],
		});
		const source = new BufferByteSource(file);
		expect(await ai5WinFormat.detect(source, "sample.arc")).toBe(true);
		const archive = await ai5WinFormat.open(source, "sample.arc");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"first.bmp",
				"second.mes",
			]);
			const [one, two] = archive.entries;
			if (!one || !two) throw new Error("no entries");
			expect(Number(one.size)).toBe(first.length);
			expect(Number(two.size)).toBe(second.length);
			expect(archive.metadata).toMatchObject({
				count: 2,
				scheme: "read-out-of-the-index",
			});
			// A picture of a name the walk of the engine stands of stands of that walk, and one of any
			// other name stands of its own places.
			expect(await consumeBuffer(await archive.openEntry(one.id))).toEqual(
				first,
			);
			const packed = Buffer.from("12345678", "latin1");
			const lzss = ai5File({
				nameLength: 0x14,
				nameKey: 0x11,
				sizeKey: 0x22222222,
				offsetKey: 0x33333333,
				entries: [
					{ name: "first.bmp", data: Buffer.alloc(4, 0x00) },
					{ name: "story.mes", data: lzssLiterals(packed) },
				],
			});
			const packedSource = new BufferByteSource(lzss);
			const packedArchive = await ai5WinFormat.open(packedSource, "other.arc");
			try {
				const script = packedArchive.entries[1];
				if (!script) throw new Error("no entry");
				expect(script.compressed).toBe(true);
				expect(
					await consumeBuffer(await packedArchive.openEntry(script.id)),
				).toEqual(packed);
			} finally {
				await packedArchive.close();
			}
		} finally {
			await archive.close();
		}
	});

	it("reads an index of another count of the places of a name as well", async () => {
		const file = ai5File({
			nameLength: 0x100,
			nameKey: 0x7f,
			sizeKey: 0x01020304,
			offsetKey: 0x05060708,
			entries: [
				{ name: "a.bin", data: Buffer.alloc(3, 0x01) },
				{ name: "b.bin", data: Buffer.alloc(5, 0x02) },
			],
		});
		const source = new BufferByteSource(file);
		expect(await ai5WinFormat.detect(source, "sample.arc")).toBe(true);
		const archive = await ai5WinFormat.open(source, "sample.arc");
		try {
			expect(archive.entries.map((entry) => entry.path)).toEqual([
				"a.bin",
				"b.bin",
			]);
		} finally {
			await archive.close();
		}
	});

	it("stands of no file the count of which names no picture or no shape of an index", async () => {
		const entries = [
			{ name: "a.bin", data: Buffer.alloc(4, 0x01) },
			{ name: "b.bin", data: Buffer.alloc(4, 0x02) },
		];
		// A file of no shape of an index that reads: the places of the second picture stand of the cipher
		// of the counts at nought, which the guess of the reference turns away.
		const noKey = ai5File({
			nameLength: 0x14,
			nameKey: 0x5a,
			sizeKey: 0x00000000,
			offsetKey: 0x00000000,
			entries,
		});
		// A name of a place below the least place of a name of the engine.
		const control = ai5File({
			nameLength: 0x14,
			nameKey: 0x5a,
			sizeKey: 0x0f0f0f0f,
			offsetKey: 0x12345678,
			entries,
		});
		control[4] = 0x01 ^ 0x5a; // the first place of the name of the first picture
		// A name of no place of no name within the count of the scheme.
		const unterminated = ai5File({
			nameLength: 0x14,
			nameKey: 0x5a,
			sizeKey: 0x0f0f0f0f,
			offsetKey: 0x12345678,
			entries: [
				{ name: "c.bin", data: Buffer.alloc(4, 0x03) },
				...entries.slice(1),
			],
		});
		Buffer.alloc(0x14, 0x41 ^ 0x5a).copy(unterminated, 4);
		// A file of one picture alone, of which the reference reads no shape at all.
		const single = ai5File({
			nameLength: 0x14,
			nameKey: 0x5a,
			sizeKey: 0x0f0f0f0f,
			offsetKey: 0x12345678,
			entries: [entries[0] as FixtureEntry],
		});
		for (const [what, file] of [
			["no cipher at all", noKey],
			["a place of no name of the engine", control],
			["no place of no name within the name", unterminated],
			["one picture alone", single],
		] as [string, Buffer][]) {
			const source = new BufferByteSource(file);
			expect(await ai5WinFormat.detect(source, "other.arc"), what).toBe(false);
		}
	});
});
