import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	neFormat,
	readNeLayout,
} from "../../packages/formats/src/microsoft/ne-archive.js";

const NE_HEADER = 0x40;
const TABLE_AT = 0x80;
const SHIFT = 4;
const FILE_SIZE = 0x600;
const VERSION_AT = 0x500;
const VERSION_KEY_AT = 6;

/** Writes one NE resource table record. */
function typeRecord(
	data: Buffer,
	at: number,
	rawType: number,
	count: number,
): number {
	data.writeUInt16LE(rawType, at);
	data.writeUInt16LE(count, at + 2);
	return at + 8;
}

/** Writes one NE resource entry record: offset, size, flags and id, all in table units. */
function entryRecord(
	data: Buffer,
	at: number,
	offset: number,
	size: number,
	id: number,
): number {
	data.writeUInt16LE(offset, at);
	data.writeUInt16LE(size, at + 2);
	data.writeUInt16LE(0, at + 4);
	data.writeUInt16LE(id, at + 6);
	return at + 12;
}

/**
 * Builds a small NE executable: the DOS stub, the NE header whose resource table count sits at
 * `0x24`, and a resource table holding a named type, a numeric type, `RT_VERSION` and an unknown
 * type, each with one or two entries.
 */
function buildNeFile(): Buffer {
	const data = Buffer.alloc(FILE_SIZE, 0x00);
	data.write("MZ", 0, "latin1");
	data.writeUInt32LE(NE_HEADER, 0x3c);
	data.write("NE", NE_HEADER, "latin1");
	data.writeUInt16LE(TABLE_AT - NE_HEADER, NE_HEADER + 0x24);
	data.writeUInt16LE(SHIFT, TABLE_AT);
	let at = TABLE_AT + 2;
	at = typeRecord(data, at, 0x8002, 2);
	at = entryRecord(data, at, 0x10, 0x20, 7);
	at = entryRecord(data, at, 0x30, 0x05, 0x8009);
	at = typeRecord(data, at, 10, 1);
	at = entryRecord(data, at, 0x40, 0x02, 3);
	at = typeRecord(data, at, 0x8010, 1);
	at = entryRecord(data, at, 0x50, 0x06, 1);
	at = typeRecord(data, at, 0x8fff, 1);
	at = entryRecord(data, at, 0x55, 0x01, 1);
	data.writeUInt16LE(0, at);
	data.write("bitmap one", 0x100, "latin1");
	data.write("data three", 0x400, "latin1");
	data.write("final blob", 0x550, "latin1");
	writeVersionResource(data, VERSION_AT);
	return data;
}

/**
 * A conforming VS_VERSIONINFO head: `wLength`, `wValueLength`, `wType` and the UTF-16 key. The
 * reference compares `VS_VERSION_INFO` against the string it reads at the type word, so this is
 * exactly the resource that shows its version path cannot be reached.
 */
function writeVersionResource(data: Buffer, at: number): void {
	const key = Buffer.from("VS_VERSION_INFO", "utf16le");
	data.writeUInt16LE(0x5c, at);
	data.writeUInt16LE(52, at + 2);
	data.writeUInt16LE(0, at + 4);
	key.copy(data, at + VERSION_KEY_AT);
	data.writeUInt16LE(0, at + VERSION_KEY_AT + key.length);
	const fixedAt = (at + VERSION_KEY_AT + key.length + 2 + 3) & ~3;
	data.writeUInt32LE(0xfeef04bd, fixedAt);
}

describe("Microsoft NE executable resources", () => {
	it("rejects files that are not NE executables", () => {
		expect(readNeLayout(Buffer.alloc(0x20, 0x00), 0x20n)).toBeUndefined();
		expect(
			readNeLayout(Buffer.alloc(FILE_SIZE, 0x00), BigInt(FILE_SIZE)),
		).toBeUndefined();
		const noNe = buildNeFile();
		noNe.write("XX", NE_HEADER, "latin1");
		expect(readNeLayout(noNe, BigInt(FILE_SIZE))).toBeUndefined();
		const badPointer = buildNeFile();
		badPointer.writeUInt32LE(FILE_SIZE, 0x3c);
		expect(readNeLayout(badPointer, BigInt(FILE_SIZE))).toBeUndefined();
		const badTable = buildNeFile();
		badTable.writeUInt16LE(0, NE_HEADER + 0x24);
		expect(readNeLayout(badTable, BigInt(FILE_SIZE))).toBeUndefined();
	});

	it("rejects an empty resource table and a table cut short", () => {
		const empty = buildNeFile();
		empty.writeUInt16LE(0, TABLE_AT + 2);
		expect(readNeLayout(empty, BigInt(FILE_SIZE))).toBeUndefined();
		// The first type record asks for two entries; a head that ends inside the second one has no
		// complete table, and the port stops rather than reading past it as the reference does.
		expect(
			readNeLayout(buildNeFile().subarray(0, 0x96), BigInt(FILE_SIZE)),
		).toBeUndefined();
	});

	it("walks the resource table", () => {
		const layout = readNeLayout(buildNeFile(), BigInt(FILE_SIZE));
		if (!layout) throw new Error("no layout");
		expect(layout.shift).toBe(SHIFT);
		expect(layout.entries.map((entry) => entry.name)).toEqual([
			"RT_BITMAP/00007",
			"RT_BITMAP/00009",
			"#10/00003",
			"RT_VERSION/00001",
			"#4095/00001",
		]);
		expect(layout.entries.map((entry) => entry.offset)).toEqual([
			0x100n,
			0x300n,
			0x400n,
			0x500n,
			0x550n,
		]);
		expect(layout.entries.map((entry) => entry.size)).toEqual([
			0x200n,
			0x50n,
			0x20n,
			0x60n,
			0x10n,
		]);
		// The integer flag of an id is cleared, while the id of an unlisted type keeps the value the
		// type word held once its own flag was cleared.
		expect(layout.entries.map((entry) => entry.nameId)).toEqual([
			7, 9, 3, 1, 1,
		]);
		expect(layout.entries.map((entry) => entry.typeId)).toEqual([
			2, 2, 10, 16, 0xfff,
		]);
	});

	it("names the types the reference names and numbers the rest", () => {
		const layout = readNeLayout(buildNeFile(), BigInt(FILE_SIZE));
		if (!layout) throw new Error("no layout");
		expect(layout.entries[0]?.name.startsWith("RT_BITMAP/")).toBe(true);
		expect(layout.entries[2]?.name.startsWith("#10/")).toBe(true);
	});

	it("detects, lists and extracts through the registered format", async () => {
		const data = buildNeFile();
		await expect(neFormat.detect(new BufferByteSource(data))).resolves.toBe(
			true,
		);
		await expect(
			neFormat.detect(new BufferByteSource(Buffer.alloc(FILE_SIZE, 0x00))),
		).resolves.toBe(false);
		await expect(
			neFormat.detect(new BufferByteSource(Buffer.from("MZ", "latin1"))),
		).resolves.toBe(false);
		const archive = await neFormat.open(new BufferByteSource(data), "game.exe");
		expect(archive.metadata.entryCount).toBe(5);
		expect(archive.metadata.shift).toBe(SHIFT);
		const bitmap = archive.entries[0];
		const numeric = archive.entries[2];
		if (!bitmap || !numeric) throw new Error("missing entries");
		expect(bitmap.path).toBe("RT_BITMAP/00007");
		expect(bitmap.metadata?.resourceType).toBe("RT_BITMAP");
		expect(numeric.metadata?.resourceType).toBe("#10");
		expect(
			(await consumeBuffer(await archive.openEntry(bitmap.id)))
				.subarray(0, 10)
				.toString("latin1"),
		).toBe("bitmap one");
		expect(
			(await consumeBuffer(await archive.openEntry(numeric.id)))
				.subarray(0, 10)
				.toString("latin1"),
		).toBe("data three");
		await expect(
			neFormat.open(
				new BufferByteSource(Buffer.alloc(FILE_SIZE, 0x00)),
				"game.exe",
			),
		).rejects.toBeInstanceOf(GarbroError);
	});

	it("hands a version resource over as stored", async () => {
		const data = buildNeFile();
		const version = data.subarray(VERSION_AT, VERSION_AT + 0x5c);
		// The fixture is a conforming resource: the key sits where the format puts it, and the word
		// the reference reads in its place is the type word, whose first byte ends the string at once.
		expect(
			version
				.subarray(VERSION_KEY_AT, VERSION_KEY_AT + 32)
				.toString("utf16le")
				.replace(/\0.*$/, ""),
		).toBe("VS_VERSION_INFO");
		expect(version.readUInt16LE(4)).toBe(0);
		const archive = await neFormat.open(new BufferByteSource(data), "game.exe");
		const entry = archive.entries.find(
			(candidate) => candidate.metadata?.versionResource === true,
		);
		if (!entry) throw new Error("no version entry");
		expect(entry.path).toBe("RT_VERSION/00001");
		const extracted = await consumeBuffer(await archive.openEntry(entry.id));
		// The entry holds 0x60 bytes while the resource declares 0x5c; the stored bytes are handed
		// over whole, so the resource head is intact and unchanged.
		expect(extracted).toHaveLength(0x60);
		expect(extracted.subarray(0, version.length).equals(version)).toBe(true);
	});
});
