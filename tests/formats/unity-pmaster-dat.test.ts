import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decryptPMasterPlaces,
	encryptPMasterPlaces,
	generatePMasterKey,
	readPMasterLayout,
	unityPMasterDatDescriptor,
	unityPMasterDatFormat,
} from "../../packages/formats/src/unity/pmaster-dat.js";

/** The two files the archive of the tests holds, as they stand in the clear. */
const FILE_0 = Buffer.from("000102030405060708090a0b0c0d0e0f10", "hex");
const FILE_1 = Buffer.from("202122232425262728292a2b2c2d2e2f", "hex");
const NAMES = ["Scripts/Start.txt", "data/Icon.png"];
const KEYS = [0x42424242, 0x0badf00d];

/** The places of the walk of the files, of the walk of the names and of the files themselves, every one of
 * them stood under the walk of its own key. The archive stands worked out with a walk of the key of its own,
 * so its places stand under walks this port did not work out. */
const INDEX = Buffer.from(
	"796f1fe52fa79da9bae52f195b676b4bbb09e91fea21797fafe97baf5edf3a84",
	"hex",
);
const NAMES_PLACES = Buffer.from(
	"6e20d7c24fa53ae670450ebbc76fb3c775fdb7a6d50a40ce5c5649732fb94e9b",
	"hex",
);
const BLOB = Buffer.from(
	"e91a2d9e23f4e30c939091f6c9aead925b8f08cdc8e98af5cc819415e6091e7bf2",
	"hex",
);
/** The walk of the files of the archive as it stands in the clear, which the archive of the tests stands
 * under. */
const INDEX_PLAIN = Buffer.from(
	"000000004004000011000000424242421200000051040000100000000df0ad0b",
	"hex",
);
/** Where the walk of the names stands from, and where the walk of the files does. */
const NAMES_SEED = 7;
const INDEX_SEED = 9;
/** Where the places of the first file stand. */
const FIRST_OFFSET = 0x440;

/** The head of such an archive: how many files it holds stands as the places of the head counted as four and
 * thirty places of their own apiece, and the two places the walks stand from stand in it. */
function pmasterHead(count: number): Buffer {
	const head = Buffer.alloc(0x400, 0x00);
	head.writeInt32LE(count, 0);
	// Every place of the head counts as a file of the archive, so the places that stand beside the two the
	// walks stand from stand them back.
	head.writeUInt32LE(NAMES_SEED, 0x5c);
	head.writeInt32LE(-NAMES_SEED, 0x60);
	head.writeUInt32LE(INDEX_SEED, 0xd4);
	head.writeInt32LE(-INDEX_SEED, 0xd8);
	return head;
}

describe("Unity PMaster engine resource archive", () => {
	it("stands the walk of a key of its own from the place the head names", () => {
		// The walk stands worked out with another walk of the key of its own, which stands the same places.
		expect(generatePMasterKey(9).subarray(0, 8).toString("hex")).toBe(
			"afb9c933397d4b7f",
		);
		expect(generatePMasterKey(0).length).toBe(0x100);
	});

	it("stands the places of a walk under the walk of its key and stands them back", () => {
		const places = Buffer.from("00112233445566778899aabbccddeeff", "hex");
		for (const seed of [0, 7, 9, 0xdeadbeef]) {
			expect(
				decryptPMasterPlaces(encryptPMasterPlaces(places, seed), seed),
			).toEqual(places);
		}
		// Every place of a walk stands under the place of the key that stands at the same place of the key,
		// four and forty places of the key standing beside it.
		expect(decryptPMasterPlaces(Buffer.alloc(4, 0), 9).toString("hex")).toBe(
			"df2535a3",
		);
	});

	it("reads the walk of the files and the walk of their names", () => {
		const archive = Buffer.concat([pmasterHead(2), INDEX, NAMES_PLACES, BLOB]);
		expect(readPMasterLayout(archive, archive.length)).toEqual({
			count: 2,
			indexLength: 0x20,
			entries: [
				{
					name: NAMES[0],
					offset: FIRST_OFFSET,
					size: FILE_0.length,
					key: KEYS[0],
				},
				{
					name: NAMES[1],
					offset: FIRST_OFFSET + FILE_0.length,
					size: FILE_1.length,
					key: KEYS[1],
				},
			],
		});
	});

	it("turns away a file whose head names no file at all", () => {
		expect(readPMasterLayout(Buffer.alloc(0x400), 0x400)).toBeUndefined();
		// The places of the head count as files, so a head that counts more than it holds is turned away.
		const head = Buffer.alloc(0x400, 0x00);
		head.writeInt32LE(0x20000, 0);
		expect(readPMasterLayout(head, 0x400)).toBeUndefined();
		expect(readPMasterLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("turns away an archive whose walk of the files stands outside it", () => {
		const head = pmasterHead(2);
		expect(
			readPMasterLayout(Buffer.concat([head, INDEX]), 0x420),
		).toBeUndefined();
		// A walk of the files whose first file stands behind the head stands as no walk at all.
		const plain = Buffer.from(INDEX_PLAIN);
		plain.writeUInt32LE(0x10, 4);
		const behind = encryptPMasterPlaces(plain, INDEX_SEED);
		expect(
			readPMasterLayout(
				Buffer.concat([head, behind, NAMES_PLACES, BLOB]),
				0x400 + 0x20 + 0x20 + BLOB.length,
			),
		).toBeUndefined();
	});

	it("reads the files of an archive as they stand in the clear", async () => {
		const archive = Buffer.concat([pmasterHead(2), INDEX, NAMES_PLACES, BLOB]);
		const handle = await unityPMasterDatFormat.open(
			new BufferByteSource(archive),
			"archive.dat",
		);
		expect(handle.entries.map((entry) => entry.path)).toEqual(NAMES);
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
		expect(unityPMasterDatDescriptor.id).toBe("unity-pmaster-dat");
		const archive = Buffer.concat([pmasterHead(2), INDEX, NAMES_PLACES, BLOB]);
		await expect(
			unityPMasterDatFormat.detect(new BufferByteSource(archive)),
		).resolves.toBe(true);
		await expect(
			unityPMasterDatFormat.detect(
				new BufferByteSource(Buffer.from("not an archive at all")),
			),
		).resolves.toBe(false);
		expect(unityPMasterDatFormat.detection).toEqual({
			signatures: [],
			priority: -1,
		});
	});
});
