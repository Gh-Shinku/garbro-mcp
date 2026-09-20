import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decryptRgssPlaces,
	encryptRgssPlaces,
	readRgssLayout,
	rpgMakerRgssAdDescriptor,
	rpgMakerRgssAdFormat,
	RgssKeyGenerator,
} from "../../packages/formats/src/rpg-maker/rgss-ad.js";

/** The two files the archives of the tests hold, as they stand in the clear. */
const FILE_0 = Buffer.from("000102030405060708090a0b0c0d0e0f10", "hex");
const FILE_1 = Buffer.from("202122232425262728292a2b2c2d2e2f", "hex");
const NAMES = ["Scripts/Map001.rvdata2", "Graphics/Icon.png"];

/** An RPG Maker engine archive of the first kind: the walk of the files stands between the places of the
 * files, every place of the walk and of the files standing under a walk of keys of its own. The archive stands
 * worked out with a walk of the key of its own, so its places stand under a walk this port did not work out. */
const V1 = Buffer.from(
	"5247535341440001e8caaddea6d58f87f5d2fef158f76dfe95b783cc43125cdaa454dc61" +
		"cd689ead9fde51bd49085e03246051454ce19e8fac9ddd12243cfe8d2f8e0d5a7f1e01" +
		"6b087d30f206f26ff1bdbf2db96a734b110d75d7572aa8c345",
	"hex",
);
/** The same files in an archive of the third kind, whose walk stands as a walk of its own at the front of the
 * file behind the key of the walk. */
const V3 = Buffer.from(
	"5247535341440003785634126c0ad7a32a0ad7a38dca7aa82d0ad7a36869a5ca" +
		"4b7ea48c766ba7930b3bf9d14d6eb6d75a38530ad7a32b0ad7a39dca7aa82a0a" +
		"d7a37c78b6d35363b4d01443b4cc5524a7cd5c3b0ad7a3b6c1af08f941c656e6" +
		"eb4b378939c3aab686e18f28a961e676f6f66b173932e38a",
	"hex",
);

describe("RPG Maker engine resource archive", () => {
	it("stands every key of a walk from the key before it", () => {
		const keys = new RgssKeyGenerator(0xdeadcafe);
		expect([
			keys.getNext(),
			keys.getNext(),
			keys.getNext(),
			keys.getNext(),
		]).toEqual([0xdeadcafe, 0x16c08cf5, 0x9f43dab6, 0x5adafafd]);
		// The key of a walk stands in four and thirty places of its own.
		const wrapped = new RgssKeyGenerator(0xfffffffe);
		expect(wrapped.getNext()).toBe(0xfffffffe);
		// The key stands in four and thirty places of its own, so the places behind the highest place stand
		// over to the front of the key.
		expect(wrapped.getNext()).toBe(0xfffffff5);
	});

	it("stands the places of a file under the walk of its own key and stands them back", () => {
		const places = Buffer.from("00112233445566778899aabbccddeeff", "hex");
		const seed = 0x12345678;
		expect(decryptRgssPlaces(encryptRgssPlaces(places, seed), seed)).toEqual(
			places,
		);
		// Every four places of a file stand under one key, the places of the key standing one by one.
		expect([...decryptRgssPlaces(Buffer.alloc(4, 0x00), seed)]).toEqual([
			0x78, 0x56, 0x34, 0x12,
		]);
	});

	it("reads the walk of an archive of the first kind", () => {
		expect(readRgssLayout(V1, V1.length)).toEqual({
			version: 1,
			entries: [
				{ name: NAMES[0], offset: 38, size: FILE_0.length, key: 3718098078 },
				{ name: NAMES[1], offset: 80, size: FILE_1.length, key: 2584714909 },
			],
		});
	});

	it("reads the walk of an archive of the third kind", () => {
		const layout = readRgssLayout(V3, V3.length);
		if (!layout) throw new Error("the archive stands in the file");
		expect(layout.version).toBe(3);
		expect(layout.entries.map((entry) => entry.name)).toEqual(NAMES);
		expect(layout.entries.map((entry) => entry.size)).toEqual([
			FILE_0.length,
			FILE_1.length,
		]);
	});

	it("turns away a file whose head does not hold its own words", () => {
		const wrongWord = Buffer.from(V1);
		wrongWord.write("AX\0", 4, "latin1");
		expect(readRgssLayout(wrongWord, wrongWord.length)).toBeUndefined();
		expect(readRgssLayout(Buffer.alloc(8), 8)).toBeUndefined();
	});

	it("turns away an archive of a kind the reference does not read", () => {
		const second = Buffer.from(V1);
		second[7] = 2;
		expect(readRgssLayout(second, second.length)).toBeUndefined();
		const fourth = Buffer.from(V3);
		fourth[7] = 4;
		expect(readRgssLayout(fourth, fourth.length)).toBeUndefined();
	});

	it("turns away a walk whose files stand outside the archive", () => {
		// The first file of the archive of the first kind names more places than the file holds.
		const longer = Buffer.from(V1);
		longer.writeUInt32LE(0x1000, 34);
		expect(readRgssLayout(longer, longer.length)).toBeUndefined();
	});

	it("reads the files of an archive of either kind as they stand in the clear", async () => {
		for (const archive of [V1, V3]) {
			const handle = await rpgMakerRgssAdFormat.open(
				new BufferByteSource(archive),
				"Game.rgssad",
			);
			expect(handle.entries.map((entry) => entry.path)).toEqual(NAMES);
			expect(handle.metadata).toMatchObject({ encrypted: true });
			const first = await consumeBuffer(
				await handle.openEntry(handle.entries[0]?.id ?? ""),
			);
			const second = await consumeBuffer(
				await handle.openEntry(handle.entries[1]?.id ?? ""),
			);
			expect(first).toEqual(FILE_0);
			expect(second).toEqual(FILE_1);
		}
	});

	it("finds an archive of its own kind", async () => {
		expect(rpgMakerRgssAdDescriptor.id).toBe("rpg-maker-rgss-ad");
		expect(rpgMakerRgssAdDescriptor.extensions).toEqual([
			"rgssad",
			"rgss2a",
			"rgss3a",
		]);
		await expect(
			rpgMakerRgssAdFormat.detect(new BufferByteSource(V3)),
		).resolves.toBe(true);
		await expect(
			rpgMakerRgssAdFormat.detect(
				new BufferByteSource(Buffer.from("not an archive at all")),
			),
		).resolves.toBe(false);
	});
});
