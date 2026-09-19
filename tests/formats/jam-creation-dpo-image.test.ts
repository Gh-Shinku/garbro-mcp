import { Buffer } from "node:buffer";
import { BufferByteSource } from "@garbro-mcp/core";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { describe, expect, it } from "vitest";
import {
	composeDpo,
	type DpoLayout,
	jamCreationDpoImageFormat,
	readDpoLayout,
} from "../../packages/formats/src/jam-creation/dpo-image.js";
import { writeBmp32 } from "../../packages/formats/src/shared/bmp.js";
import { withCompanionFiles } from "../helpers/companion.js";

const NAME_SIZE = 0x20;
const HEADER_SIZE = 0x30;

interface TileInput {
	file: number;
	x: number;
	y: number;
	offsetX: number;
	offsetY: number;
	width?: number;
	height?: number;
}

/** A Jam Creation picture: the head, the shape of the canvas, the names of the tiles and the layout. */
function dpoFile(input: {
	width: number;
	height: number;
	version?: number;
	names: string[];
	tileSize: number;
	tiles: TileInput[];
}): Buffer {
	const version = input.version ?? 1;
	const infoOffset = HEADER_SIZE;
	const nameTableOffset = infoOffset + 4;
	const nameTableSize = 2 + input.names.length * NAME_SIZE;
	const layoutOffset = nameTableOffset + nameTableSize;
	const head = Buffer.alloc(HEADER_SIZE, 0x00);
	head.write("Divided Picture", 0, "latin1");
	head.writeInt32LE(1, 0x10);
	head.writeInt32LE(version, 0x14);
	head.writeInt32LE(infoOffset, 0x18);
	head.writeInt32LE(4, 0x1c);
	head.writeInt32LE(nameTableOffset, 0x20);
	head.writeInt32LE(nameTableSize, 0x24);
	head.writeInt32LE(layoutOffset, 0x28);
	const info = Buffer.alloc(4, 0x00);
	info.writeUInt16LE(input.width, 0);
	info.writeUInt16LE(input.height, 2);
	const table = Buffer.alloc(nameTableSize, 0x00);
	table.writeUInt16LE(input.names.length, 0);
	input.names.forEach((name, index) => {
		table.write(name, 2 + index * NAME_SIZE, "latin1");
	});
	const room = 8 * 4 + 2 + 2 + 2 + (version > 1 ? 4 : 0);
	const layout = Buffer.alloc(8 + input.tiles.length * room, 0x00);
	layout.writeInt32LE(input.tiles.length, 0);
	layout.writeInt32LE(input.tileSize, 4);
	let at = 8;
	for (const tile of input.tiles) {
		layout.writeFloatLE(tile.offsetX, at);
		layout.writeFloatLE(tile.offsetY, at + 0x10);
		layout.writeUInt16LE(tile.file, at + 0x20);
		layout.writeUInt16LE(tile.x, at + 0x22);
		layout.writeUInt16LE(tile.y, at + 0x24);
		at += 0x26;
		if (version > 1) {
			layout.writeUInt16LE(tile.width ?? input.tileSize, at);
			layout.writeUInt16LE(tile.height ?? input.tileSize, at + 2);
			at += 4;
		}
	}
	return Buffer.concat([head, info, table, layout]);
}

/** Four places of width and four of height of four byte places, in the order a bitmap holds them. */
function tileBitmap(color: (x: number, y: number) => number[]): Buffer {
	const size = 4;
	const pixels = Buffer.alloc(size * size * 4, 0x00);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const entry = color(x, y);
			const at = (y * size + x) * 4;
			pixels[at] = entry[0] ?? 0;
			pixels[at + 1] = entry[1] ?? 0;
			pixels[at + 2] = entry[2] ?? 0;
			pixels[at + 3] = entry[3] ?? 0;
		}
	}
	return writeBmp32(size, size, pixels);
}

/** The first picture: its blue and its green name the place, its red stands for the picture itself. */
function firstTile(): Buffer {
	return tileBitmap((x, y) => [0x10 + x, 0x20 + y, 0x30, 0xff]);
}

/** The second picture, whose shape of a place is not a whole one. */
function secondTile(): Buffer {
	return tileBitmap((x, y) => [0x40 + x, 0x50 + y, 0x60, 0xee]);
}

const LAYOUT: DpoLayout = {
	width: 4,
	height: 4,
	version: 1,
	names: ["first.bmp", "second.bmp"],
	tileSize: 2,
	tiles: [
		{ fileNumber: 0, x: 0, y: 0, offsetX: 0, offsetY: 0, width: 2, height: 2 },
		{
			fileNumber: 1,
			x: 2,
			y: 2,
			offsetX: 0.5,
			offsetY: 0.5,
			width: 2,
			height: 2,
		},
	],
};

/** The places of a picture of four by four, handed to the walk that puts the canvas together. */
function tileSource(color: (x: number, y: number) => number[]): {
	width: number;
	height: number;
	bgra: Buffer;
} {
	const size = 4;
	const bgra = Buffer.alloc(size * size * 4, 0x00);
	for (let y = 0; y < size; y += 1) {
		for (let x = 0; x < size; x += 1) {
			const entry = color(x, y);
			const at = (y * size + x) * 4;
			bgra[at] = entry[0] ?? 0;
			bgra[at + 1] = entry[1] ?? 0;
			bgra[at + 2] = entry[2] ?? 0;
			bgra[at + 3] = entry[3] ?? 0;
		}
	}
	return { width: size, height: size, bgra };
}

describe("Jam Creation tiled image format", () => {
	it("reads the head of a picture", () => {
		const data = dpoFile({
			width: 4,
			height: 4,
			names: ["first.bmp", "second.bmp"],
			tileSize: 2,
			tiles: [
				{ file: 0, x: 0, y: 0, offsetX: 0, offsetY: 0 },
				{ file: 1, x: 2, y: 2, offsetX: 0.5, offsetY: 0.5 },
			],
		});
		expect(readDpoLayout(data)).toEqual(LAYOUT);
		// The second shape of the layout names how many places of a picture a tile takes.
		const second = dpoFile({
			width: 4,
			height: 4,
			version: 2,
			names: ["first.bmp"],
			tileSize: 2,
			tiles: [
				{ file: 0, x: 0, y: 0, offsetX: 0, offsetY: 0, width: 1, height: 3 },
			],
		});
		expect(readDpoLayout(second)?.tiles).toEqual([
			{
				fileNumber: 0,
				x: 0,
				y: 0,
				offsetX: 0,
				offsetY: 0,
				width: 1,
				height: 3,
			},
		]);
	});

	it("turns away a file that is not a picture of this engine", () => {
		const data = dpoFile({
			width: 4,
			height: 4,
			names: ["first.bmp"],
			tileSize: 2,
			tiles: [{ file: 0, x: 0, y: 0, offsetX: 0, offsetY: 0 }],
		});
		const word = Buffer.from(data);
		word.write("Divided PicturE", 0, "latin1");
		expect(readDpoLayout(word)).toBeUndefined();
		const flag = Buffer.from(data);
		flag.writeInt32LE(2, 0x10);
		expect(readDpoLayout(flag)).toBeUndefined();
		const version = Buffer.from(data);
		version.writeInt32LE(3, 0x14);
		expect(readDpoLayout(version)).toBeUndefined();
		const table = Buffer.from(data);
		table.writeInt32LE(2 + NAME_SIZE + 1, 0x24);
		expect(readDpoLayout(table)).toBeUndefined();
		// A name table that stands behind the file is turned away.
		const missing = Buffer.from(data);
		missing.writeInt32LE(data.length + 4, 0x20);
		expect(() => readDpoLayout(missing)).toThrow(
			"Jam Creation picture is cut short of its names",
		);
	});

	it("stands the tiles of a picture on its canvas", () => {
		const canvas = composeDpo(
			[
				tileSource((x, y) => [0x10 + x, 0x20 + y, 0x30, 0xff]),
				tileSource((x, y) => [0x40 + x, 0x50 + y, 0x60, 0xee]),
			],
			LAYOUT,
		);
		expect(canvas.readInt32LE(0x16)).toBe(-4);
		expect(canvas.subarray(0x36, 0x36 + 64).toString("hex")).toBe(
			hex([
				0x10, 0x20, 0x30, 0xff, 0x11, 0x20, 0x30, 0xff, 0, 0, 0, 0, 0, 0, 0, 0,
				0x10, 0x21, 0x30, 0xff, 0x11, 0x21, 0x30, 0xff, 0, 0, 0, 0, 0, 0, 0, 0,
				0, 0, 0, 0, 0, 0, 0, 0, 0x42, 0x52, 0x60, 0xee, 0x43, 0x52, 0x60, 0xee,
				0, 0, 0, 0, 0, 0, 0, 0, 0x42, 0x53, 0x60, 0xee, 0x43, 0x53, 0x60, 0xee,
			]),
		);
	});

	it("leaves out what stands beyond the canvas", () => {
		const layout: DpoLayout = {
			...LAYOUT,
			tiles: [
				{
					fileNumber: 0,
					x: 3,
					y: 3,
					offsetX: 0,
					offsetY: 0,
					width: 2,
					height: 2,
				},
			],
		};
		const canvas = composeDpo(
			[tileSource((x, y) => [0x10 + x, 0x20 + y, 0x30, 0xff])],
			layout,
		);
		// Only the one place of the tile that stands on the canvas is written.
		expect(canvas.subarray(0x36 + 60, 0x36 + 64).toString("hex")).toBe(
			hex([0x10, 0x20, 0x30, 0xff]),
		);
		expect(canvas.subarray(0x36, 0x36 + 60).toString("hex")).toBe(
			"00".repeat(60),
		);
	});

	it("turns away a tile that stands beyond its picture", () => {
		const layout: DpoLayout = {
			...LAYOUT,
			tiles: [
				{
					fileNumber: 0,
					x: 0,
					y: 0,
					offsetX: 0.9,
					offsetY: 0,
					width: 2,
					height: 2,
				},
			],
		};
		expect(() =>
			composeDpo([tileSource((x, y) => [x, y, 0, 0xff])], layout),
		).toThrow("Jam Creation tile stands beyond its picture");
	});

	it("takes the pictures of its tiles from beside the file", async () => {
		const data = dpoFile({
			width: 4,
			height: 4,
			names: [".\\first.bmp", "second.bmp"],
			tileSize: 2,
			tiles: [
				{ file: 0, x: 0, y: 0, offsetX: 0, offsetY: 0 },
				{ file: 1, x: 2, y: 2, offsetX: 0.5, offsetY: 0.5 },
			],
		});
		await withCompanionFiles(
			"picture.dpo",
			{ "first.bmp": firstTile(), "second.bmp": secondTile() },
			async (mainPath) => {
				const handle = await jamCreationDpoImageFormat.open(
					new BufferByteSource(data),
					mainPath,
				);
				const entry = handle.entries[0];
				if (!entry) throw new Error("no entry");
				expect(entry).toMatchObject({
					path: "picture.bmp",
					metadata: {
						type: "image",
						width: 4,
						height: 4,
						bitsPerPixel: 32,
						tiles: 2,
					},
				});
				expect(handle.metadata).toEqual({ image: "bmp", bitsPerPixel: 32 });
				const canvas = await consumeBuffer(await handle.openEntry(entry.id));
				expect(canvas.subarray(0x36 + 40, 0x36 + 48).toString("hex")).toBe(
					hex([0x42, 0x52, 0x60, 0xee, 0x43, 0x52, 0x60, 0xee]),
				);
			},
		);
	});

	it("turns away a picture whose tiles do not stand beside it", async () => {
		const data = dpoFile({
			width: 4,
			height: 4,
			names: ["first.bmp"],
			tileSize: 2,
			tiles: [{ file: 0, x: 0, y: 0, offsetX: 0, offsetY: 0 }],
		});
		await withCompanionFiles("picture.dpo", {}, async (mainPath) => {
			expect(
				await jamCreationDpoImageFormat.detect(
					new BufferByteSource(data),
					mainPath,
				),
			).toBe(true);
			const handle = await jamCreationDpoImageFormat.open(
				new BufferByteSource(data),
				mainPath,
			);
			const entry = handle.entries[0];
			if (!entry) throw new Error("no entry");
			await expect(handle.openEntry(entry.id)).rejects.toThrow(
				"Jam Creation picture has no tiles beside it",
			);
		});
	});
});

/** The bytes of a picture, so that what is expected stands as the numbers it is made of. */
function hex(bytes: number[]): string {
	return Buffer.from(bytes).toString("hex");
}
