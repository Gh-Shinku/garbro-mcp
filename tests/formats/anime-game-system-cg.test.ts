import { Buffer } from "node:buffer";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	animeGameSystemCgImageFormat,
	readCgLayout,
	unpackCgPicture,
} from "../../packages/formats/src/anime-game-system/cg-image.js";

const HEAD_SIZE = 5;
const PART_HEAD_SIZE = 0xd;

const PICTURES: readonly {
	name: string;
	width: number;
	height: number;
	file: string;
	out: string;
}[] = [
	{
		name: "whole",
		width: 4,
		height: 2,
		file: "00040002000040800141810242820343830444840545850646860747870848880949890a4a8a0b4b8b0c4c8c0d4d8d0e4e8e0f4f8f1050901151911252921353931454941555951656961757971858981959991a5a9a1b5b9b1c5c9c1d5d9d1e5e9e1f5f9f2060a02161a12262a22363a32464a42565a52666a62767a72868a82969a92a6aaa2b6bab2c6cac2d6dad2e6eae2f6faf3070b03171b13272b23373b33474b43575b53676b63777b73878b83979b93a7aba3b7bbb3c7cbc3d7dbd3e7ebe3f7fbf4080c04181c14282c24383c34484c44585c54686c64787c74888c84989c94a8aca4b8bcb4c8ccc4d8dcd4e8ece4f8fcf5090d05191d15292d25393d35494d45595d55696d65797d75898d85999d95a9ada5b9bdb5c9cdc5d9ddd5e9ede5f9fdf60a0e061a1e162a2e263a3e364a4e465a5e566a6e667a7e768a8e869a9e96aaaea6babeb6cacec6daded6eaeee6fafef70b0f071b1f172b2f273b3f374b4f475b5f576b6f677b7f778b8f879b9f97abafa7bbbfb7cbcfc7dbdfd7ebefe7fbfff8211028373",
		out: "02428202428200ff0000ff0003438300ff0003438300ff00",
	},
	{
		name: "part",
		width: 4,
		height: 3,
		file: "010400030001000100030002000040800141810242820343830444840545850646860747870848880949890a4a8a0b4b8b0c4c8c0d4d8d0e4e8e0f4f8f1050901151911252921353931454941555951656961757971858981959991a5a9a1b5b9b1c5c9c1d5d9d1e5e9e1f5f9f2060a02161a12262a22363a32464a42565a52666a62767a72868a82969a92a6aaa2b6bab2c6cac2d6dad2e6eae2f6faf3070b03171b13272b23373b33474b43575b53676b63777b73878b83979b93a7aba3b7bbb3c7cbc3d7dbd3e7ebe3f7fbf4080c04181c14282c24383c34484c44585c54686c64787c74888c84989c94a8aca4b8bcb4c8ccc4d8dcd4e8ece4f8fcf5090d05191d15292d25393d35494d45595d55696d65797d75898d85999d95a9ada5b9bdb5c9cdc5d9ddd5e9ede5f9fdf60a0e061a1e162a2e263a3e364a4e465a5e566a6e667a7e768a8e869a9e96aaaea6babeb6cacec6daded6eaeee6fafef70b0f071b1f172b2f273b3f374b4f475b5f576b6f677b7f778b8f879b9f97abafa7bbbfb7cbcfc7dbdfd7ebefe7fbfff81118171",
		out: "00ff0000ff0000ff0000ff0000ff0001418101418100ff0000ff0000ff0000ff0000ff00",
	},
	{
		name: "rgb",
		width: 2,
		height: 1,
		file: "1002000100804020d0",
		out: "004020003e1e",
	},
];

describe("Anime Game System image format", () => {
	it("reads the head of a picture of a kind of the places of a picture of a part of it", () => {
		const whole = Buffer.from(PICTURES[0]?.file ?? "", "hex");
		expect(readCgLayout(whole, whole.length)).toEqual({
			type: 0,
			width: 4,
			height: 2,
			left: 0,
			top: 0,
			right: 4,
			bottom: 2,
			dataOffset: HEAD_SIZE,
		});
		const part = Buffer.from(PICTURES[1]?.file ?? "", "hex");
		expect(readCgLayout(part, part.length)).toMatchObject({
			type: 1,
			width: 4,
			height: 3,
			left: 1,
			top: 1,
			right: 3,
			bottom: 2,
			dataOffset: PART_HEAD_SIZE,
		});
	});

	it("turns away a head that names no picture of this kind", () => {
		expect(readCgLayout(Buffer.from([0x20, 4, 0, 2, 0]), 5)).toBeUndefined();
		expect(readCgLayout(Buffer.from([0x00, 0, 0, 2, 0]), 5)).toBeUndefined();
		expect(readCgLayout(Buffer.from([0x00, 4, 0, 0, 0]), 5)).toBeUndefined();
		expect(readCgLayout(Buffer.alloc(4), 4)).toBeUndefined();
		const bad = Buffer.alloc(PART_HEAD_SIZE, 0x00);
		bad[0] = 0x01;
		bad.writeInt16LE(4, 1);
		bad.writeInt16LE(2, 3);
		bad.writeInt16LE(3, 5);
		bad.writeInt16LE(0, 7);
		bad.writeInt16LE(1, 9);
		bad.writeInt16LE(1, 11);
		expect(readCgLayout(bad, PART_HEAD_SIZE)).toBeUndefined();
	});

	it("reads the places of the pictures of the test", () => {
		for (const picture of PICTURES) {
			const file = Buffer.from(picture.file, "hex");
			const layout = readCgLayout(file, file.length);
			if (!layout) throw new Error(`no layout for ${picture.name}`);
			expect(unpackCgPicture(file, layout), picture.name).toEqual(
				Buffer.from(picture.out, "hex"),
			);
		}
	});

	it("stands the places of a picture out as a picture of the three places of a place of it", async () => {
		for (const picture of PICTURES) {
			const file = Buffer.from(picture.file, "hex");
			const handle = await animeGameSystemCgImageFormat.open(
				new BufferByteSource(file),
				`${picture.name}.cg`,
			);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			const bmp = await consumeBuffer(await handle.openEntry(entry.id));
			expect(bmp.subarray(0, 2).toString("latin1")).toBe("BM");
			expect(bmp.readUInt16LE(0x1c)).toBe(24);
			expect(bmp.readInt32LE(0x12)).toBe(picture.width);
			expect(bmp.readInt32LE(0x16)).toBe(-picture.height);
			const places = Buffer.from(picture.out, "hex");
			const stride = (picture.width * 3 + 3) & ~3;
			for (let row = 0; row < picture.height; row += 1) {
				expect(
					bmp.subarray(
						0x36 + row * stride,
						0x36 + row * stride + picture.width * 3,
					),
					picture.name,
				).toEqual(
					places.subarray(
						row * picture.width * 3,
						(row + 1) * picture.width * 3,
					),
				);
			}
		}
	});

	it("turns a picture whose places stand short of the walk of them away", () => {
		const file = Buffer.from(PICTURES[0]?.file ?? "", "hex");
		const cut = file.subarray(0, file.length - 3);
		const layout = readCgLayout(cut, cut.length);
		if (!layout) throw new Error("no layout");
		expect(() => unpackCgPicture(cut, layout)).toThrow(GarbroError);
		// And a picture cut short of the words of the head of it stands away as well.
		expect(() =>
			unpackCgPicture(cut.subarray(0, 8), { ...layout, dataOffset: 5 }),
		).toThrow(GarbroError);
	});

	it("is told by the places of the head of the picture", async () => {
		expect(animeGameSystemCgImageFormat.descriptor.id).toBe(
			"anime-game-system-cg",
		);
		const whole = Buffer.from(PICTURES[0]?.file ?? "", "hex");
		await expect(
			animeGameSystemCgImageFormat.detect(new BufferByteSource(whole)),
		).resolves.toBe(true);
		await expect(
			animeGameSystemCgImageFormat.detect(
				new BufferByteSource(Buffer.from([0x20, 4, 0, 2, 0])),
			),
		).resolves.toBe(false);
	});
});
