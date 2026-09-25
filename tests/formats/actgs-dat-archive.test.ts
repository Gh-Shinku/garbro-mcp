import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";
import {
	actressDatFormat,
	readActressIndex,
} from "../../packages/formats/src/actgs/dat-archive.js";

const HEADER_SIZE = 0x10;
const INDEX_ENTRY_SIZE = 0x20;
const NAME_LENGTH = 0x18;

interface WantedEntry {
	name: string;
	content: Buffer;
	/** A place the entry names itself, for the files that do not stand one behind the other. */
	offset?: number;
}

/**
 * An archive of this engine: the head, then one record per entry - where it stands, how long it is and its
 * name - and behind the index the data of the entries, one after the other.
 */
function buildArchive(wanted: readonly WantedEntry[]): Buffer {
	const indexEnd = HEADER_SIZE + wanted.length * INDEX_ENTRY_SIZE;
	const sizes = wanted.map((entry) => entry.content.length);
	const places = wanted.map((entry, number) => {
		if (entry.offset !== undefined) return entry.offset;
		let at = indexEnd;
		for (let before = 0; before < number; before += 1) {
			at += sizes[before] ?? 0;
		}
		return at;
	});
	const end = Math.max(
		indexEnd,
		...places.map((place, number) => place + (sizes[number] ?? 0)),
	);
	// The head and the index of this engine carry nothing but what it says they do, so the fixture starts
	// empty and only the data behind the index is filled with a byte the entries have to cover.
	const data = Buffer.alloc(end, 0x00);
	data.writeInt32LE(wanted.length, 0);
	for (const [number, entry] of wanted.entries()) {
		const at = HEADER_SIZE + number * INDEX_ENTRY_SIZE;
		data.writeUInt32LE(places[number] ?? 0, at);
		data.writeUInt32LE(sizes[number] ?? 0, at + 4);
		data.write(entry.name, at + 8, "latin1");
	}
	data.fill(0x5a, indexEnd);
	for (const [number, entry] of wanted.entries()) {
		entry.content.copy(data, places[number] ?? 0);
	}
	return data;
}

const PLAIN = [
	{ name: "TITLE.GRP", content: Buffer.from("first picture", "latin1") },
	{ name: "TEXT.SCR", content: Buffer.from("a script of its own", "latin1") },
];

describe("ACTGS engine resource archive", () => {
	it("lists and hands over the entries of a plain archive", async () => {
		await expectArchive({
			format: actressDatFormat,
			archive: buildArchive(PLAIN),
			sourcePath: "ACTRESS.DAT",
			entries: PLAIN.map((entry) => ({
				path: entry.name,
				size: entry.content.length,
				content: entry.content,
			})),
			metadata: { extension: "dat" },
		});
	});

	it("reads the head and the index as the reference does", () => {
		const data = buildArchive(PLAIN);
		const index = readActressIndex(data, BigInt(data.length));
		expect(index?.firstOffset).toBe(
			HEADER_SIZE + PLAIN.length * INDEX_ENTRY_SIZE,
		);
		// The first entry stands where the index ends and the other follows it.
		expect(index?.actualOffset).toBe(index?.firstOffset);
		expect(index?.entries.map((entry) => entry.name)).toEqual(
			PLAIN.map((entry) => entry.name),
		);
		expect(index?.entries[0]).toMatchObject({
			offset: HEADER_SIZE + PLAIN.length * INDEX_ENTRY_SIZE,
			size: PLAIN[0]?.content.length,
		});
	});

	it("turns away a head that names nothing or carries a word of its own", async () => {
		const empty = buildArchive([]);
		expect(
			await actressDatFormat.detect(new BufferByteSource(empty), "a.dat"),
		).toBe(false);
		await expect(
			actressDatFormat.open(new BufferByteSource(empty), "a.dat"),
		).rejects.toThrow(GarbroError);

		for (const at of [4, 8, 0xc]) {
			const altered = buildArchive(PLAIN);
			altered.writeUInt32LE(1, at);
			expect(
				await actressDatFormat.detect(new BufferByteSource(altered), "a.dat"),
			).toBe(false);
		}
	});

	it("turns away an entry that stands past the end of the archive", () => {
		const data = buildArchive(PLAIN);
		// The second entry is told to reach past the end of the file.
		data.writeUInt32LE(data.length - 2, HEADER_SIZE + INDEX_ENTRY_SIZE);
		data.writeUInt32LE(0x40, HEADER_SIZE + INDEX_ENTRY_SIZE + 4);
		expect(readActressIndex(data, BigInt(data.length))).toBeUndefined();
	});

	it("refuses a keyed archive by name, since the reference's key table is empty", async () => {
		// The first entry stands at 0x20 where the index ends at 0x30, so the two places part.
		const keyed = buildArchive([
			{
				name: "TEXT.SCR",
				content: Buffer.alloc(0x40, 0x41),
				offset: 0x20,
			},
		]);
		expect(keyed.readUInt32LE(HEADER_SIZE)).toBe(0x20);
		const source = new BufferByteSource(keyed);
		expect(await actressDatFormat.detect(source, "ACTRESS.DAT")).toBe(false);
		await expect(
			actressDatFormat.open(new BufferByteSource(keyed), "ACTRESS.DAT"),
		).rejects.toThrow(/key table ships empty/);
	});

	it("keeps a name that fills the whole field and one that is empty", async () => {
		const full = "A".repeat(NAME_LENGTH);
		const wanted = [
			{ name: full, content: Buffer.from("one", "latin1") },
			{ name: "", content: Buffer.from("two", "latin1") },
		];
		const data = buildArchive(wanted);
		const index = readActressIndex(data, BigInt(data.length));
		expect(index?.entries.map((entry) => entry.name)).toEqual([full, ""]);
		await expectArchive({
			format: actressDatFormat,
			archive: data,
			sourcePath: "ACTRESS.DAT",
			entries: wanted.map((entry) => ({
				path: entry.name,
				size: entry.content.length,
			})),
		});
	});

	it("is told by its own name, as the reference tells it", async () => {
		const data = buildArchive(PLAIN);
		for (const path of ["a.bin", "a.dat.bak", "a"]) {
			expect(
				await actressDatFormat.detect(new BufferByteSource(data), path),
			).toBe(false);
		}
		expect(
			await actressDatFormat.detect(new BufferByteSource(data), "a.DAT"),
		).toBe(true);
	});
});
