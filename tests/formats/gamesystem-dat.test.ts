import { BufferByteSource } from "@garbro-mcp/core";
import {
	gamesystemDatFormat,
	restoreGamesystemName,
} from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { expectArchive } from "../helpers/archive.js";

const SECTOR_SIZE = 0x200;
const INDEX_OFFSET = 0x400;
const RECORD_SIZE = 0x10;
const END_MARKER = Buffer.alloc(12, 0xff);

interface File {
	name: string;
	extension: string;
	content: Buffer;
}

/** Packs a base name and extension into the record's twelve-byte packed field. */
function encodeName(name: string, extension: string): Buffer {
	const characters = Buffer.alloc(16, 0x20);
	Buffer.from(name, "ascii").copy(characters, 0, 0, 12);
	Buffer.from(extension, "ascii").copy(characters, 12, 0, 4);
	const field = Buffer.alloc(12);
	for (let source = 0, target = 0; source < 12; source += 3, target += 4) {
		const word =
			((characters[target] ?? 0) - 0x20) * 0x40000 +
			((characters[target + 1] ?? 0) - 0x20) * 0x1000 +
			((characters[target + 2] ?? 0) - 0x20) * 0x40 +
			((characters[target + 3] ?? 0) - 0x20);
		field[source] = (word >> 16) & 0xff;
		field[source + 1] = (word >> 8) & 0xff;
		field[source + 2] = word & 0xff;
	}
	return field;
}

/**
 * Builds an archive whose payloads each occupy one sector, so every record offset is a sector count
 * the reference can shift back. The trailing record carries the end-of-file offset and an all-ones
 * name field.
 */
function buildDat(files: readonly File[]): {
	archive: Buffer;
	indexSize: number;
} {
	const indexSize = 0x600;
	const archive = Buffer.alloc(indexSize + files.length * SECTOR_SIZE);
	archive.writeUInt32LE(indexSize / SECTOR_SIZE, 0);
	for (const [id, file] of files.entries()) {
		const record = INDEX_OFFSET + id * RECORD_SIZE;
		encodeName(file.name, file.extension).copy(archive, record);
		archive.writeUInt32LE(id + 3, record + 12);
		file.content.copy(archive, indexSize + id * SECTOR_SIZE);
	}
	const end = INDEX_OFFSET + files.length * RECORD_SIZE;
	END_MARKER.copy(archive, end);
	archive.writeUInt32LE(files.length + 3, end + 12);
	return { archive, indexSize };
}

/** The stored extent of an entry covers a whole sector, so payloads are zero padded. */
function padded(content: Buffer, sectorSize = SECTOR_SIZE): Buffer {
	const buffer = Buffer.alloc(sectorSize);
	content.copy(buffer);
	return buffer;
}

describe("0verflow DAT resource archive", () => {
	it("restores names from the packed six-bit fields", () => {
		// The six-bit fields only cover 0x20..0x5F, so archive names are uppercase.
		expect(restoreGamesystemName(encodeName("FIRST", "DAT"))).toBe("FIRST.DAT");
		expect(restoreGamesystemName(encodeName("FRAME", "CRGB"))).toBe(
			"FRAME.CRGB",
		);
		expect(restoreGamesystemName(encodeName("NOEXT", ""))).toBe("NOEXT");
	});

	it("lists sector-sized entries and types image extensions", async () => {
		const first = Buffer.from("first payload");
		const second = Buffer.from("second payload");
		const { archive } = buildDat([
			{ name: "FIRST", extension: "DAT", content: first },
			{ name: "FRAME", extension: "CRGB", content: second },
		]);
		await expectArchive({
			format: gamesystemDatFormat,
			archive,
			metadata: { entryCount: 2 },
			entries: [
				{
					path: "FIRST.DAT",
					size: SECTOR_SIZE,
					content: padded(first),
				},
				{
					path: "FRAME.CRGB",
					size: SECTOR_SIZE,
					content: padded(second),
				},
			],
		});
		const listing = await (async () => {
			const source = new BufferByteSource(archive);
			return await gamesystemDatFormat.open(source, "sample.dat");
		})();
		try {
			expect(listing.entries[1]?.metadata).toEqual({ type: "image" });
		} finally {
			await listing.close();
		}
	});

	it("rejects a first offset that does not match the index end", async () => {
		const { archive } = buildDat([
			{ name: "FIRST", extension: "DAT", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(4, INDEX_OFFSET + 12);
		const source = new BufferByteSource(archive);
		expect(await gamesystemDatFormat.detect(source, "sample.dat")).toBe(false);
	});

	it("rejects a name that starts with a space", async () => {
		const { archive } = buildDat([
			{ name: "FIRST", extension: "DAT", content: Buffer.from("payload") },
		]);
		// Six-bit zeroes decode to spaces, which the reference rejects.
		archive.fill(0, INDEX_OFFSET, INDEX_OFFSET + 12);
		const source = new BufferByteSource(archive);
		expect(await gamesystemDatFormat.detect(source, "sample.dat")).toBe(false);
	});

	it("rejects offsets that stop increasing", async () => {
		const { archive } = buildDat([
			{ name: "FIRST", extension: "DAT", content: Buffer.from("payload") },
		]);
		const end = INDEX_OFFSET + RECORD_SIZE;
		archive.writeUInt32LE(1, end + 12);
		const source = new BufferByteSource(archive);
		expect(await gamesystemDatFormat.detect(source, "sample.dat")).toBe(false);
	});

	it("rejects an index without an end marker", async () => {
		const { archive } = buildDat([
			{ name: "FIRST", extension: "DAT", content: Buffer.from("payload") },
		]);
		// Turn the end record into another file record so the walk runs out of index.
		encodeName("SECOND", "DAT").copy(archive, INDEX_OFFSET + RECORD_SIZE);
		const source = new BufferByteSource(archive);
		expect(await gamesystemDatFormat.detect(source, "sample.dat")).toBe(false);
	});

	it("rejects a sector count that is too small", async () => {
		const { archive } = buildDat([
			{ name: "FIRST", extension: "DAT", content: Buffer.from("payload") },
		]);
		archive.writeUInt32LE(2, 0);
		const source = new BufferByteSource(archive);
		expect(await gamesystemDatFormat.detect(source, "sample.dat")).toBe(false);
	});
});
