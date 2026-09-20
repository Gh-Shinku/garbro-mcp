import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	decodeYkImage,
	readYkLayout,
	unpackYkEntry,
	koeiYkFormat,
} from "../../packages/formats/src/koei/yk-archive.js";
import {
	YK_DATA02_IMAGES,
	YK_OFFSET_TABLES,
} from "../../packages/formats/src/koei/yk-tables.js";

const DATA01_BLOCK = 0x4b400;
const DATA03_KEY = 0x12c4d65;

/** The last offset of a table is the exact length of the smallest archive it can describe. */
function tableSize(name: string): bigint {
	const offsets = YK_OFFSET_TABLES.get(name);
	if (!offsets) throw new Error(`no table ${name}`);
	return BigInt(offsets[offsets.length - 1] ?? 0);
}

describe("Koei YK resource archive", () => {
	it("gates the layout on the name and the block division", () => {
		expect(readYkLayout(1024n, "DATA04.YK")).toBeUndefined();
		expect(readYkLayout(tableSize("DATA04"), "DATA04.bin")).toBeUndefined();
		expect(readYkLayout(tableSize("DATA04"), "DATA99.YK")).toBeUndefined();
		expect(readYkLayout(0n, "DATA01.YK")).toBeUndefined();
		expect(
			readYkLayout(BigInt(DATA01_BLOCK * 2 + 1), "DATA01.YK"),
		).toBeUndefined();
		expect(readYkLayout(BigInt(DATA01_BLOCK * 2), "data01.yk")?.data01).toBe(
			true,
		);
	});

	it("plans the fixed DATA01 blocks", () => {
		const layout = readYkLayout(BigInt(DATA01_BLOCK * 3), "DATA01.YK");
		if (!layout) throw new Error("no layout");
		expect(layout.archiveName).toBe("DATA01");
		expect(layout.entries).toHaveLength(3);
		expect(layout.entries.map((entry) => entry.name)).toEqual([
			"00000.BMP",
			"00001.BMP",
			"00002.BMP",
		]);
		const second = layout.entries[1];
		expect(second?.offset).toBe(BigInt(DATA01_BLOCK));
		expect(second?.size).toBe(BigInt(DATA01_BLOCK));
		expect(second?.kind).toBe("image");
		expect(second?.image).toEqual({ width: 640, height: 480, bpp: 8 });
		expect(second?.mixed).toBe(false);
	});

	it("plans a plain offset table archive", () => {
		const offsets = YK_OFFSET_TABLES.get("DATA04");
		if (!offsets) throw new Error("no table DATA04");
		const layout = readYkLayout(tableSize("DATA04"), "DATA04.YK");
		if (!layout) throw new Error("no layout");
		expect(layout.data01).toBe(false);
		expect(layout.entries).toHaveLength(offsets.length);
		expect(layout.entries[0]?.name).toBe("DATA04#0000");
		expect(layout.entries[0]?.offset).toBe(0n);
		expect(layout.entries[0]?.size).toBe(BigInt(offsets[0] ?? 0));
		expect(layout.entries[1]?.offset).toBe(BigInt(offsets[0] ?? 0));
		expect(layout.entries[1]?.size).toBe(
			BigInt((offsets[1] ?? 0) - (offsets[0] ?? 0)),
		);
		expect(layout.entries[0]?.kind).toBe("data");
		expect(layout.entries[0]?.mixed).toBe(false);
		expect(layout.entries[0]?.image).toBeUndefined();
	});

	it("names the DATA02 pictures after the geometry table", () => {
		// The reference names an entry a picture when its id reaches eleven or the table lists it,
		// and only the ids the table gives geometry to reach a decoder.
		const layout = readYkLayout(tableSize("DATA02"), "DATA02.YK");
		if (!layout) throw new Error("no layout");
		const byIndex = new Map(
			layout.entries.map((entry) => [entry.index, entry]),
		);
		expect(byIndex.get(0)?.name).toBe("DATA02#0000.BMP");
		expect(byIndex.get(0)?.kind).toBe("image");
		expect(byIndex.get(0)?.image).toEqual({
			width: 0x168,
			height: 0x90,
			bpp: 8,
		});
		expect(YK_DATA02_IMAGES.get(4)).toBeNull();
		expect(byIndex.get(4)?.name).toBe("DATA02#0004.BMP");
		expect(byIndex.get(4)?.undecoded).toBe(true);
		expect(byIndex.get(4)?.image).toBeUndefined();
		expect(byIndex.get(5)?.name).toBe("DATA02#0005");
		expect(byIndex.get(5)?.kind).toBe("data");
		expect(byIndex.get(11)?.name).toBe("DATA02#0011.BMP");
		expect(byIndex.get(11)?.image).toEqual({ width: 888, height: 480, bpp: 8 });
		// From id 189 on the reference uses one fixed geometry whatever the table holds.
		expect(byIndex.get(189)?.image).toEqual({
			width: 128,
			height: 192,
			bpp: 8,
		});
		expect(byIndex.get(layout.entries.length - 1)?.image).toEqual({
			width: 128,
			height: 192,
			bpp: 8,
		});
	});

	it("names the audio archives and puts a wave head in front of them", () => {
		const layout = readYkLayout(tableSize("DATA05"), "DATA05.YK");
		if (!layout) throw new Error("no layout");
		expect(layout.entries[0]?.name).toBe("DATA05#0000.WAV");
		expect(layout.entries[0]?.kind).toBe("audio");
		const stored = Buffer.from([1, 2, 3, 4]);
		const unpacked = unpackYkEntry(stored, { kind: "audio", mixed: false });
		expect(unpacked).toHaveLength(16 + stored.length);
		expect(unpacked.subarray(0, 4).toString("latin1")).toBe("RIFF");
		expect(unpacked.readUInt32LE(4)).toBe(stored.length + 8);
		expect(unpacked.subarray(8, 16).toString("latin1")).toBe("WAVEfmt ");
		expect(unpacked.subarray(16).equals(stored)).toBe(true);
	});

	it("mixes only the whole words of a DATA03 entry", () => {
		const layout = readYkLayout(tableSize("DATA03"), "DATA03.YK");
		if (!layout) throw new Error("no layout");
		expect(layout.entries[0]?.mixed).toBe(true);
		expect(layout.entries[0]?.name).toBe("DATA03#0000");
		const stored = Buffer.from([0x01, 0x00, 0x00, 0x00, 0xff, 0xaa]);
		const unpacked = unpackYkEntry(stored, { kind: "data", mixed: true });
		expect(unpacked.readUInt32LE(0)).toBe(0x12c4d64);
		expect(unpacked.readUInt32LE(0)).toBe((0x00000001 ^ DATA03_KEY) >>> 0);
		// The trailing two bytes are not a whole word and stay as stored.
		expect(unpacked.subarray(4).equals(Buffer.from([0xff, 0xaa]))).toBe(true);
		// The stored buffer is left alone: the reference works on its own copy of the entry.
		expect(stored.readUInt32LE(0)).toBe(1);
	});

	it("wraps a picture into a bottom up indexed bitmap", () => {
		const palette = Buffer.alloc(0x400, 0x00);
		palette.writeUInt32LE(0x00112233, 0);
		const pixels = Buffer.from([1, 2, 3, 4]);
		const bmp = decodeYkImage(Buffer.concat([palette, pixels]), {
			width: 2,
			height: 2,
			bpp: 8,
		});
		expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
		expect(bmp.readInt32LE(0x12)).toBe(2);
		// `ImageData.CreateFlipped` rows are stored bottom up, which a bitmap records with a
		// positive height.
		expect(bmp.readInt32LE(0x16)).toBe(2);
		expect(bmp.readUInt16LE(0x1c)).toBe(8);
		expect(bmp.readUInt32LE(0x2e)).toBe(256);
		expect(bmp.readUInt32LE(0x0a)).toBe(0x36 + 0x400);
		expect(bmp.readUInt32LE(0x36)).toBe(0x00112233);
		// Two byte rows are padded to four, in the stored order.
		expect(
			bmp.subarray(0x436).equals(Buffer.from([1, 2, 0, 0, 3, 4, 0, 0])),
		).toBe(true);
		expect(() =>
			decodeYkImage(Buffer.alloc(0x400 + 3), { width: 2, height: 2, bpp: 8 }),
		).toThrow(GarbroError);
	});

	it("detects, lists and extracts through the registered format", async () => {
		const size = Number(tableSize("DATA04"));
		const data = Buffer.alloc(size, 0x00);
		data.write("stored entry", 0, "latin1");
		const source = new BufferByteSource(data);
		await expect(koeiYkFormat.detect(source, "DATA04.YK")).resolves.toBe(true);
		await expect(koeiYkFormat.detect(source, "DATA04.bin")).resolves.toBe(
			false,
		);
		await expect(koeiYkFormat.detect(source, "DATA99.YK")).resolves.toBe(false);
		const archive = await koeiYkFormat.open(
			new BufferByteSource(data),
			"DATA04.YK",
		);
		expect(archive.metadata.archiveName).toBe("DATA04");
		expect(archive.entries).toHaveLength(10);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		expect(entry.metadata?.type).toBe("data");
		const extracted = await consumeBuffer(await archive.openEntry(entry.id));
		expect(extracted.subarray(0, 12).toString("latin1")).toBe("stored entry");
	});

	it("mixes the entries of a DATA03 archive on extraction", async () => {
		const size = Number(tableSize("DATA03"));
		const data = Buffer.alloc(size, 0x00);
		data.writeUInt32LE(0x00000001, 0);
		const archive = await koeiYkFormat.open(
			new BufferByteSource(data),
			"DATA03.YK",
		);
		expect(archive.entries[0]?.encrypted).toBe(true);
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const extracted = await consumeBuffer(await archive.openEntry(entry.id));
		expect(extracted.readUInt32LE(0)).toBe((1 ^ DATA03_KEY) >>> 0);
	});
});
