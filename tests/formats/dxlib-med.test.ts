import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	medFormat,
	readMedIndex,
} from "../../packages/formats/src/dxlib/med.js";

/** An archive of two files: the head, the index of two places, and the places of the files. The head names
 * every place of the index as twenty places, twelve of them naming a file of the archive. */
/** Where the places of the first file of the archive stand. */
const FIRST_OFFSET = 0x38;
/** Where the places of the second file of the archive stand. */
const SECOND_OFFSET = 0x3c;
const ARCHIVE = buildArchive();

function buildArchive(): Buffer {
	const entryLength = 0x14;
	const nameLength = 0x0c;
	const head = Buffer.alloc(0x10, 0x00);
	head.write("MD", 0, "latin1");
	head.writeUInt16LE(entryLength, 4);
	head.writeUInt16LE(2, 6);
	const index = Buffer.alloc(entryLength * 2, 0x00);
	index.write("first.bin", 0, "latin1");
	index.writeUInt32LE(4, nameLength);
	index.writeUInt32LE(FIRST_OFFSET, nameLength + 4);
	index.writeUInt32LE(2, entryLength + nameLength);
	index.writeUInt32LE(SECOND_OFFSET, entryLength + nameLength + 4);
	return Buffer.concat([
		head,
		index,
		Buffer.from([1, 2, 3, 4]),
		Buffer.from([5, 6]),
	]);
}

describe("DxLib resource archive", () => {
	it("reads the index of an archive", () => {
		expect(readMedIndex(ARCHIVE, ARCHIVE.length)).toEqual({
			entryLength: 0x14,
			nameLength: 0x0c,
			entries: [
				{ name: "first.bin", offset: FIRST_OFFSET, size: 4 },
				{ name: "", offset: SECOND_OFFSET, size: 2 },
			],
		});
	});

	it("turns away a head that names no index", () => {
		const wrongMark = Buffer.from(ARCHIVE);
		wrongMark.write("MX", 0, "latin1");
		expect(readMedIndex(wrongMark, wrongMark.length)).toBeUndefined();
		const shortPlace = Buffer.from(ARCHIVE);
		shortPlace.writeUInt16LE(8, 4);
		expect(readMedIndex(shortPlace, shortPlace.length)).toBeUndefined();
		const noFiles = Buffer.from(ARCHIVE);
		noFiles.writeUInt16LE(0, 6);
		expect(readMedIndex(noFiles, noFiles.length)).toBeUndefined();
		const cut = Buffer.from(ARCHIVE.subarray(0, ARCHIVE.length - 2));
		cut.writeUInt32LE(0x40, 0x10 + 0x0c + 4);
		expect(readMedIndex(cut, cut.length)).toBeUndefined();
		expect(readMedIndex(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("hands out the places of the files of an archive as they stand", async () => {
		const handle = await medFormat.open(
			new BufferByteSource(ARCHIVE),
			"data.med",
		);
		try {
			expect(handle.metadata).toMatchObject({
				entryCount: 2,
				entryLength: 0x14,
				nameLength: 0x0c,
			});
			expect(handle.entries.map((entry) => entry.path)).toEqual([
				"first.bin",
				// The reference names a file of the archive by the words the index names it with, so a file the
				// index names with nothing stands as no words at all.
				"entry_1",
			]);
			expect(handle.entries.map((entry) => entry.size)).toEqual([4n, 2n]);
			for (const [at, content] of [
				[0, Buffer.from([1, 2, 3, 4])],
				[1, Buffer.from([5, 6])],
			] as Array<[number, Buffer]>) {
				const entry = handle.entries[at];
				if (!entry) throw new Error("no entry");
				expect(await consumeBuffer(await handle.openEntry(entry.id))).toEqual(
					content,
				);
			}
		} finally {
			await handle.close();
		}
	});

	it("turns a place of the index that stands outside the archive away", async () => {
		const data = Buffer.from(ARCHIVE);
		data.writeUInt32LE(0x3c, 0x10 + 0x0c);
		expect(readMedIndex(data, data.length)).toBeUndefined();
		await expect(
			medFormat.open(new BufferByteSource(data), "data.med"),
		).rejects.toThrow(GarbroError);
	});

	it("is told by the words of the head rather than by a word of its own", async () => {
		expect(medFormat.descriptor.id).toBe("dxlib-med");
		expect(medFormat.descriptor.extensions).toEqual(["med"]);
		expect(medFormat.detection).toEqual({ signatures: [] });
		await expect(medFormat.detect(new BufferByteSource(ARCHIVE))).resolves.toBe(
			true,
		);
		const wrongMark = Buffer.from(ARCHIVE);
		wrongMark.write("MX", 0, "latin1");
		await expect(
			medFormat.detect(new BufferByteSource(wrongMark)),
		).resolves.toBe(false);
		const noFiles = Buffer.from(ARCHIVE);
		noFiles.writeUInt16LE(0, 6);
		await expect(medFormat.detect(new BufferByteSource(noFiles))).resolves.toBe(
			false,
		);
	});
});
