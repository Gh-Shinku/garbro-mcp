// The picture of a MAGES layer index, against a graphic written by hand: the index of the fixture names the
// places of the tiles of every layer within a graphic of four blocks this test asks for, and the places of
// the picture are read back at the places the fixture names.
import { Buffer } from "node:buffer";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { FileByteSource } from "@garbro-mcp/core";
import { nitroplusLayImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	compositeLayPicture,
	layBaseName,
	layDrawOrder,
	readLayLayout,
	readLayPicture,
} from "../../packages/formats/src/nitroplus/lay-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import { withCompanionFiles } from "../helpers/companion.js";
import { pngFile } from "../helpers/png.js";

const BASE_LAYER = 1;
const FACE_LAYER = 0x20000000;
const ASKED = 0x40000001;
const MIDDLE_X = 960;
const MIDDLE_Y = 540;

/**
 * The graphic of the fixture: four blocks of thirty two by thirty two places, of the red place first in the
 * file of a graphic, so the places of a picture of it are the red one of the four.
 */
function baseGraphic(): Buffer {
	const rows: number[][] = [];
	for (let y = 0; y < 64; y += 1) {
		const row: number[] = [];
		for (let x = 0; x < 64; x += 1) {
			// A graphic of four places a colour stands of the red place first; the block of the bottom right
			// one stands of half an alpha.
			if (y < 32 && x < 32) row.push(255, 0, 0, 255);
			else if (y < 32) row.push(0, 255, 0, 255);
			else if (x < 32) row.push(0, 0, 255, 255);
			else row.push(255, 255, 255, 0x80);
		}
		rows.push(row);
	}
	return pngFile({ width: 64, height: 64, colourType: 6, rows });
}

/** One place of the index: the places of the layer and of the graphic, of one taken off the second pair. */
function coord(
	targetX: number,
	targetY: number,
	sourceX: number,
	sourceY: number,
): Buffer {
	const out = Buffer.alloc(16, 0);
	out.writeFloatLE(targetX - 1, 0);
	out.writeFloatLE(targetY - 1, 4);
	out.writeFloatLE(sourceX + 1, 8);
	out.writeFloatLE(sourceY + 1, 12);
	return out;
}

/** The index of the engine: the count of the layers, the count of the places, the layers and the places. */
function buildLay(input: {
	layers: readonly (readonly [number, number, number])[];
	coords: readonly Buffer[];
}): Buffer {
	const head = Buffer.alloc(8 + input.layers.length * 12, 0);
	head.writeInt32LE(input.layers.length, 0);
	head.writeInt32LE(input.coords.length, 4);
	input.layers.forEach(([id, first, count], at) => {
		head.writeUInt32LE(id, 8 + at * 12);
		head.writeInt32LE(first, 12 + at * 12);
		head.writeInt32LE(count, 16 + at * 12);
	});
	return Buffer.concat([head, ...input.coords]);
}

/** The index of three layers: the layer of the word one, the face and the layer the engine asks for. */
function threeLayers(): Buffer {
	return buildLay({
		layers: [
			[BASE_LAYER, 0, 1],
			[FACE_LAYER, 1, 1],
			[ASKED, 2, 1],
		],
		coords: [
			// The tile of the base stands at the middle of the picture, of the red block of the graphic.
			coord(0, 0, 1, 1),
			// The tile of the face stands one block behind it, of the green block.
			coord(32, 0, 33, 1),
			// The tile the engine asks for stands over the tile of the base, of the block of half an alpha.
			coord(0, 0, 33, 33),
		],
	});
}

/** One place of a picture of four places, of the place of it within the picture. */
function place(pixels: Buffer, x: number, y: number): number[] {
	const at = (y * 1920 + x) * 4;
	return [...pixels.subarray(at, at + 4)];
}

describe("MAGES composite picture", () => {
	it("reads the layers and the places of the index", () => {
		const data = threeLayers();
		const layout = readLayLayout(data);
		expect(layout?.layers.length).toBe(3);
		expect(layout?.layers[0]).toEqual({ id: BASE_LAYER, first: 0, count: 1 });
		expect(layout?.coords.length).toBe(3);
		expect(layout?.coords[0]?.targetX).toBe(0);
		expect(layout?.coords[0]?.sourceX).toBe(1);
		// The four places of a place of the index stand of a single place each, and the sum of a single
		// place and a whole one stands of a single place as well.
		expect(layout?.coords[1]?.targetX).toBe(32);
		expect(layout?.coords[1]?.sourceX).toBe(33);
	});

	it("turns away what is not one of its indexes", () => {
		const good = threeLayers();
		expect(readLayLayout(good)).toBeDefined();
		const noLayers = Buffer.from(good);
		noLayers.writeInt32LE(0, 0);
		expect(readLayLayout(noLayers)).toBeUndefined();
		const tooMany = Buffer.from(good);
		tooMany.writeInt32LE(0x40000, 4);
		expect(readLayLayout(tooMany)).toBeUndefined();
		const short = Buffer.from(good);
		short.writeInt32LE(0x100, 4);
		expect(readLayLayout(short)).toBeUndefined();
		expect(readLayLayout(good.subarray(0, 4))).toBeUndefined();
	});

	it("stands of the name of the index less a trailing place of an underline", () => {
		expect(layBaseName("/games/gs/image_.lay")).toBe("image");
		expect(layBaseName("c:\\gs\\image.lay")).toBe("image");
		expect(layBaseName("/games/gs/a___.lay")).toBe("a");
		expect(layBaseName("/games/gs/image")).toBe("image");
	});

	it("lays the layer of the word one under the layer the engine asks for", async () => {
		await withCompanionFiles(
			"image_.lay",
			{ "image_.lay": threeLayers(), "image.png": baseGraphic() },
			async (mainPath) => {
				const layout = readLayLayout(threeLayers());
				const picture = await readLayPicture(mainPath);
				if (!layout || !picture) throw new Error("no layout");
				// The layer of the word one stands under the one asked for, and the face stands between
				// them.
				expect(layDrawOrder(layout, ASKED).map((layer) => layer.id)).toEqual([
					BASE_LAYER,
					FACE_LAYER,
					ASKED,
				]);
				expect(
					layDrawOrder(layout, BASE_LAYER).map((layer) => layer.id),
				).toEqual([BASE_LAYER]);
				// The layer of the word one lays the red block down at the middle of the picture.
				const base = compositeLayPicture(layout, picture, BASE_LAYER);
				expect(place(base, MIDDLE_X, MIDDLE_Y)).toEqual([0, 0, 255, 0xff]);
				// The face lays the green block down behind it, and the layer asked for stands over the red
				// one of half an alpha: white over red is the two of them one after the other.
				const pixels = compositeLayPicture(layout, picture, ASKED);
				expect(place(pixels, MIDDLE_X, MIDDLE_Y)).toEqual([
					128, 128, 255, 0xff,
				]);
				expect(place(pixels, MIDDLE_X + 32, MIDDLE_Y)).toEqual([
					0, 255, 0, 0xff,
				]);
				// A place no tile stands on stands of nothing.
				expect(place(pixels, 100, 100)).toEqual([0, 0, 0, 0]);
			},
		);
	});

	it("lays a tile of half an alpha over the places behind it", async () => {
		// The tile of the layer asked for is the block of half an alpha, of white, and it stands over the
		// red block of the base: the blend is half of each of them.
		const layout = readLayLayout(threeLayers());
		if (!layout) throw new Error("no layout");
		const picture = await (async () => {
			const { readPngImage } = await import(
				"../../packages/formats/src/shared/png-image.js"
			);
			return readPngImage(baseGraphic());
		})();
		if (!picture) throw new Error("no graphic");
		const pixels = compositeLayPicture(layout, picture, ASKED);
		expect(place(pixels, MIDDLE_X, MIDDLE_Y)).toEqual([128, 128, 255, 0xff]);
	});

	it("reads the picture through the format", async () => {
		await withCompanionFiles(
			"image_.lay",
			{ "image_.lay": threeLayers(), "image.png": baseGraphic() },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await nitroplusLayImageFormat.detect(source, mainPath)).toBe(
					true,
				);
				const handle = await nitroplusLayImageFormat.open(source, mainPath);
				expect(handle.entries.map((entry) => entry.path)).toEqual([
					"image#00000001",
					"image#20000000",
					"image#40000001",
				]);
				const entry = handle.entries[2];
				if (!entry) throw new Error("no entry");
				const bmp = await consumeBuffer(await handle.openEntry(entry.id));
				await handle.close();
				const read = readBmpImage(bmp);
				if (!read) throw new Error("no bitmap");
				expect(read.width).toBe(1920);
				expect(read.height).toBe(1080);
				const at = (MIDDLE_Y * 1920 + MIDDLE_X) * 4;
				expect([...read.pixels.subarray(at, at + 4)]).toEqual([
					128, 128, 255, 0xff,
				]);
			},
		);
	});

	it("stands of no picture where no graphic stands beside the index", async () => {
		await withCompanionFiles(
			"image_.lay",
			{ "image_.lay": threeLayers() },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await nitroplusLayImageFormat.detect(source, mainPath)).toBe(
					false,
				);
			},
		);
		await withCompanionFiles(
			"image_.dat",
			{ "image_.dat": threeLayers(), "image.png": baseGraphic() },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				expect(await nitroplusLayImageFormat.detect(source, mainPath)).toBe(
					false,
				);
			},
		);
	});
});
