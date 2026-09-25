import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { describe, expect, it } from "vitest";
import {
	cmbArchiveFormat,
	cmbIndexOf,
	cmbLayoutFor,
	detectCmbTypes,
	placesFromOffsets,
	unpackCmbEntry,
	type CmbPlace,
} from "../../packages/formats/src/pinesoft/cmb-archive.js";
import {
	CMB_LAYOUT,
	CMB_NONE,
} from "../../packages/formats/src/pinesoft/cmb-layout.js";

const NONE = CMB_NONE;

function place(input: Partial<CmbPlace> & { offset: number }): CmbPlace {
	return {
		index: 0,
		path: "00000",
		size: 0x20,
		type: "binary",
		packed: false,
		unpackedSize: 0,
		...input,
	};
}

describe("PineSoft resource archive", () => {
	it("keeps the places of the entries of every archive of the game", () => {
		expect(CMB_LAYOUT.length).toBe(8);
		const first = cmbLayoutFor(0);
		expect(first?.length).toBe(306);
		// The places of the first archive of the game, as the reference keeps them.
		expect([...(first?.slice(0, 8) ?? [])]).toEqual([
			0,
			0x70ec3,
			0xddd4a,
			0x14d337,
			0x1bc99b,
			0x229f1e,
			NONE,
			0x297c1c,
		]);
		expect(cmbLayoutFor(8)).toBeUndefined();
		expect(cmbLayoutFor(-1)).toBeUndefined();
	});

	it("tells an archive of the game by the number of its name", () => {
		expect(cmbIndexOf("cmb/0.cmb")).toBe(0);
		expect(cmbIndexOf("12.CMB")).toBe(12);
		expect(cmbIndexOf("011.cmb")).toBe(11);
		expect(cmbIndexOf("notanumber.cmb")).toBeUndefined();
		expect(cmbIndexOf("cmb")).toBeUndefined();
	});

	it("names the places of the entries of an archive and the lengths between them", () => {
		const places = placesFromOffsets([0, 0x100, NONE, 0x400, 0x600], 0x600);
		expect(
			places?.map((entry) => [entry.path, entry.offset, entry.size]),
		).toEqual([
			["00000", 0, 0x100],
			["00001", 0x100, 0x300],
			["00003", 0x400, 0x200],
		]);
		// The last place of an archive has to name the end of the archive itself.
		expect(placesFromOffsets([0, 0x100, 0x200], 0x300)).toBeUndefined();
		expect(placesFromOffsets([0, 0x300, 0x200], 0x200)).toBeUndefined();
		expect(placesFromOffsets([0], 0)).toBeUndefined();
	});

	it("tells the kind of every entry by the words it opens with", () => {
		const head = 0x10;
		const picture = 0x40;
		const sound = 0x80;
		const inner = 0xc0;
		const data = Buffer.alloc(0x200, 0x00);
		data.write("OggS", head, "latin1");
		// A picture of the engine stands behind the head of its own, which names the length it unfolds to.
		data.writeUInt32LE(0x1234, picture);
		data.writeUInt32LE(0x4450420f, picture + 4);
		// A sound of the engine names a long word of its own data and the short one of its kind.
		data.writeUInt32LE(0x40 - 0x18, sound);
		data.writeUInt32LE(0x10, sound + 4);
		// An archive standing within an archive names how many entries stand in it and how long its head is.
		const count = 3;
		data.writeInt32LE(count, inner + 0x24);
		data.writeUInt32LE((count + 1) * 4 + 0x28, inner);
		const places: CmbPlace[] = [
			place({ index: 0, offset: head, size: 0x30, path: "00000" }),
			place({ index: 1, offset: picture, size: 0x40, path: "00001" }),
			place({ index: 2, offset: sound, size: 0x40, path: "00002" }),
			place({ index: 3, offset: inner, size: 0xc0, path: "00003" }),
		];
		detectCmbTypes(data, places);
		expect(places[0]?.type).toBe("audio");
		expect(places[0]?.path).toBe("00000.ogg");
		expect(places[1]?.type).toBe("image");
		expect(places[1]?.path).toBe("00001.bpd");
		expect(places[1]?.packed).toBe(true);
		expect(places[1]?.unpackedSize).toBe(0x1234);
		expect(places[1]?.offset).toBe(picture + 4);
		expect(places[1]?.size).toBe(0x3c);
		expect(places[2]?.type).toBe("audio");
		expect(places[3]?.type).toBe("archive");
	});

	it("reads an entry the engine packs through the frame of its own walk", () => {
		// A control byte names eight decisions from its lowest bit up: a set bit a byte of its own, a clear one
		// a copy out of the frame, whose place and length share two bytes and whose length counts from three.
		const stream = Buffer.from([0x01, 0x41, 0xee, 0xf0]);
		expect([
			...unpackCmbEntry(
				stream,
				place({ offset: 0, packed: true, unpackedSize: 4 }),
			),
		]).toEqual([0x41, 0x41, 0x41, 0x41]);
		expect([...unpackCmbEntry(stream, place({ offset: 0 }))]).toEqual([
			...stream,
		]);
	});

	it("turns away a file whose name stands no archive of the game", async () => {
		const head = Buffer.alloc(0x20, 0x00);
		head.write("WARC", 0, "latin1");
		expect(
			await cmbArchiveFormat.detect?.(
				new BufferByteSource(head),
				"notanumber.cmb",
			),
		).toBe(false);
		expect(
			await cmbArchiveFormat.detect?.(new BufferByteSource(head), "9.cmb"),
		).toBe(false);
		expect(
			await cmbArchiveFormat.detect?.(new BufferByteSource(head), "0.cmb"),
		).toBe(false);
	});
});
