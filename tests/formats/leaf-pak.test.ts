import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decryptLeafPlaces,
	encryptLeafPlaces,
	leafPakDescriptor,
	leafPakFormat,
	readLeafPackLayout,
} from "../../packages/formats/src/leaf/pak.js";

/** The key the reference names first, which stands as the key of this port. */
const KEY = Buffer.from([
	0x71, 0x48, 0x6a, 0x55, 0x9f, 0x13, 0x58, 0xf7, 0xd1, 0x7c, 0x3e,
]);
/** The two files the archive of the tests holds, as they stand in the clear. */
const FILE_0 = Buffer.from("000102030405060708090a0b0c0d0e0f10111213", "hex");
const FILE_1 = Buffer.from("LEAFSCRIPT", "latin1");

/** A Leaf resource archive of two files, whose places and whose walk of names stand under the walk of the key
 * of the reference. The archive stands worked out with a walk of the key of its own, so the places of the test
 * stand under a walk this port did not work out. */
const ARCHIVE = Buffer.from(
	"4c4541465041434b020071496c58a3185efed985487c547763ae236909e4bd8d" +
		"ab9bf256aa4021d0c48bbc9eef67781725d49271526a559f2758f7d17c3e7148" +
		"ae96f3547817f19c5e91686a739f135801d17c3e71486a55",
	"hex",
);
const INDEX_OFFSET = 40;

/** One file of the walk of the names: eight places of a name, three of an extension, a place that counts for
 * nothing, the place of the file, how many places it holds, and four places that count for nothing. */
function record(
	name: string,
	extension: string,
	offset: number,
	size: number,
): Buffer {
	const out = Buffer.alloc(0x18, 0x00);
	out.write(name.padEnd(8).slice(0, 8), 0, "latin1");
	out.write(extension.padEnd(3).slice(0, 3), 8, "latin1");
	out.writeUInt32LE(offset, 0x0c);
	out.writeUInt32LE(size, 0x10);
	return out;
}

/** An archive of the files of a walk of names, whose places stand under the walk of the key. */
function leafFile(input: {
	records?: Buffer;
	files?: Buffer;
	count?: number;
	word?: string;
	signature?: string;
}): Buffer {
	const head = Buffer.alloc(0x0a, 0x00);
	head.write(input.signature ?? "LEAF", 0, "latin1");
	head.write(input.word ?? "PACK", 4, "latin1");
	head.writeInt16LE(input.count ?? 2, 8);
	const files = input.files ?? Buffer.alloc(0);
	const records = input.records ?? Buffer.alloc(0);
	return Buffer.concat([
		head,
		encryptLeafPlaces(files),
		encryptLeafPlaces(records),
	]);
}

describe("Leaf resource archive", () => {
	it("stands the places of a walk under the walk of its key and stands them back", () => {
		const places = Buffer.from("00112233445566778899aabbccddeeff", "hex");
		expect(decryptLeafPlaces(encryptLeafPlaces(places))).toEqual(places);
		// The walk of the key stands over where the walk of the places is longer than it.
		expect(
			decryptLeafPlaces(encryptLeafPlaces(Buffer.alloc(0x40, 0x5a))),
		).toEqual(Buffer.alloc(0x40, 0x5a));
		// Every place of the walk stands under the place of the key that stands at the same place.
		expect([...decryptLeafPlaces(Buffer.from([0x71, 0x48, 0x6a]))]).toEqual([
			0x00, 0x00, 0x00,
		]);
	});

	it("reads the walk of the names of an archive", () => {
		expect(readLeafPackLayout(ARCHIVE, ARCHIVE.length)).toEqual({
			count: 2,
			indexOffset: INDEX_OFFSET,
			indexSize: 0x30,
			entries: [
				{ name: "SCRIPT.TXT", offset: 0x0a, size: FILE_0.length },
				{ name: "DATA", offset: 0x0a + FILE_0.length, size: FILE_1.length },
			],
		});
	});

	it("turns away a file whose head does not hold its own words", () => {
		expect(
			readLeafPackLayout(leafFile({ signature: "LEAX" }), 0x40),
		).toBeUndefined();
		expect(
			readLeafPackLayout(leafFile({ word: "PACC" }), 0x40),
		).toBeUndefined();
		expect(readLeafPackLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("turns away an archive that names no file or more files than it holds", () => {
		expect(readLeafPackLayout(leafFile({ count: 0 }), 0x40)).toBeUndefined();
		expect(readLeafPackLayout(leafFile({ count: 8 }), 0x40)).toBeUndefined();
		// The walk of the names stands at the end of the file, so a small file holds no walk of its own.
		expect(
			readLeafPackLayout(
				Buffer.concat([Buffer.from("LEAFPACK", "latin1"), Buffer.alloc(4)]),
				0x0c,
			),
		).toBeUndefined();
	});

	it("turns away an archive whose files stand outside it", () => {
		const records = record("SCRIPT", "TXT", 0x100, 0x10);
		expect(
			readLeafPackLayout(
				leafFile({ count: 1, records, files: Buffer.alloc(0x10) }),
				0x0a + 0x10 + 0x18,
			),
		).toBeUndefined();
	});

	it("reads a name of the walk of the names only where it stands as the name of a file", () => {
		const records = Buffer.concat([
			record("WRONG/NAME", "TXT", 0x0a, 4),
			Buffer.alloc(0x18, 0xff),
		]);
		expect(
			readLeafPackLayout(
				leafFile({ count: 2, records, files: Buffer.alloc(4) }),
				0x0a + 4 + 0x30,
			),
		).toBeUndefined();
	});

	it("reads the files of an archive as they stand in the clear", async () => {
		const handle = await leafPakFormat.open(
			new BufferByteSource(ARCHIVE),
			"scene.pak",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual([
			"SCRIPT.TXT",
			"DATA",
		]);
		expect(handle.metadata).toMatchObject({ count: 2, encrypted: true });
		const first = await consumeBuffer(
			await handle.openEntry(handle.entries[0]?.id ?? ""),
		);
		const second = await consumeBuffer(
			await handle.openEntry(handle.entries[1]?.id ?? ""),
		);
		expect(first).toEqual(FILE_0);
		expect(second).toEqual(FILE_1);
	});

	it("finds an archive of its own kind", async () => {
		expect(leafPakDescriptor.id).toBe("leaf-pak");
		expect(leafPakFormat.detection).toEqual({
			signatures: [{ bytes: Buffer.from("LEAF", "latin1") }],
		});
		await expect(
			leafPakFormat.detect(new BufferByteSource(ARCHIVE), "scene.pak"),
		).resolves.toBe(true);
		await expect(
			leafPakFormat.detect(
				new BufferByteSource(Buffer.from("not an archive at all")),
				"scene.pak",
			),
		).resolves.toBe(false);
	});

	it("stands by the key of the reference", () => {
		expect(KEY.length).toBe(11);
		// A file of the archive whose places stand in the clear under the key of the reference.
		expect(decryptLeafPlaces(encryptLeafPlaces(FILE_0, KEY), KEY)).toEqual(
			FILE_0,
		);
	});
});
