// The Malie tiled picture descriptor port, against descriptors and tiles built in the test: the lines of
// the descriptor (the counts of the picture, the count of the levels and the places of the tiles of a level)
// and a `tex` directory beside it. A tile of the two kinds this project reads out of a file of its own (a
// portable network graphic and a bitmap) stands inside, of the places of the tile of a place of the walk;
// a tile of a kind of its own and a descriptor of no tiles beside it stand refused.
import { Buffer } from "node:buffer";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { FileByteSource } from "@garbro-mcp/core";
import { dziImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import { readDziDescriptor } from "../../packages/formats/src/malie/dzi-image.js";
import {
	readBmpImage,
	writeBmp24,
} from "../../packages/formats/src/shared/bmp.js";
import { pngFile } from "../helpers/png.js";

/** The lines of a descriptor of a tiled picture, of the walk of the lines of the format itself. */
function dziFile(lines: readonly string[]): Buffer {
	return Buffer.from(`DZI\r\n${lines.join("\r\n")}\r\n`, "latin1");
}

/** A directory of a descriptor and its tiles, of the walk of a descriptor of the engine. */
async function withTiles(
	descriptor: Buffer,
	tiles: Record<string, Buffer>,
	run: (mainPath: string) => Promise<void>,
): Promise<void> {
	const root = await mkdtemp(join(tmpdir(), "dzi-"));
	try {
		const texture = join(root, "tex");
		await mkdir(texture, { recursive: true });
		for (const [name, content] of Object.entries(tiles)) {
			await writeFile(join(texture, name), content);
		}
		const mainPath = join(root, "picture.dzi");
		await writeFile(mainPath, descriptor);
		await run(mainPath);
	} finally {
		await rm(root, { recursive: true, force: true });
	}
}

/** The places of a picture of the walk, read back with the reader of the project. */
async function pictureOf(mainPath: string) {
	const source = await FileByteSource.open(mainPath);
	expect(await dziImageFormat.detect(source, mainPath)).toBe(true);
	const archive = await dziImageFormat.open(source, mainPath);
	try {
		const entry = archive.entries[0];
		if (!entry) throw new Error("no entry");
		const image = readBmpImage(
			await consumeBuffer(await archive.openEntry(entry.id)),
		);
		if (!image) throw new Error("the port handed over no bitmap");
		return { image, metadata: archive.metadata };
	} finally {
		await archive.close();
	}
}

describe("Malie tiled image descriptor", () => {
	it("reads the lines of the descriptor of a picture", () => {
		const data = dziFile(["4,2", "1", "2,2", ",a.png,b.bmp", "c.bmp"]);
		const layout = readDziDescriptor(data);
		if (!layout) throw new Error("no walk of the descriptor");
		expect(layout.width).toBe(4);
		expect(layout.height).toBe(2);
		expect(layout.levels.length).toBe(1);
		const level = layout.levels[0];
		if (!level) throw new Error("no level of the picture");
		expect(level.blockWidth).toBe(2);
		expect(level.blockHeight).toBe(2);
		// A place of no name of a line of the descriptor stands of a place of the picture as well: the three
		// names of the first line stand of the places 256 apart, of the first of them of no name at all.
		expect(level.tiles).toEqual([
			{ x: 256, y: 0, fileName: "a.png" },
			{ x: 512, y: 0, fileName: "b.bmp" },
			{ x: 0, y: 256, fileName: "c.bmp" },
		]);
	});

	it("stands the places of a tile of the picture in the places of the picture of it", async () => {
		// A picture of four places by two, of a tile of two by two at the head of it: the places of the tile
		// stand of the places of the picture, and the picture is cropped to the places the tile reaches.
		const tile = pngFile({
			width: 2,
			height: 2,
			colourType: 6,
			rows: [
				[10, 20, 30, 40, 11, 21, 31, 41],
				[50, 60, 70, 80, 51, 61, 71, 81],
			],
		});
		const descriptor = dziFile(["4,2", "1", "2,1", "a.png,,b.bmp"]);
		// The tile past the places of the picture stands of a picture of its own, which the reference reads
		// and then stands past the places of the picture of the tile of it.
		const beyond = writeBmp24(1, 1, Buffer.from([1, 2, 3]));
		await withTiles(
			descriptor,
			{ "a.png": tile, "b.bmp": beyond },
			async (mainPath) => {
				const { image, metadata } = await pictureOf(mainPath);
				// The counts of the head stand in the metadata of the file where the places of the picture of the
				// walk stand cropped to the places the tiles reach.
				expect(metadata).toMatchObject({
					width: 4,
					height: 2,
					bitsPerPixel: 32,
				});
				expect(image.width).toBe(2);
				expect(image.height).toBe(2);
				// The places of the portable network graphic stand of the places of the engine the other way
				// round, which is what the walk of the tile hands over.
				expect([...image.pixels]).toEqual([
					30, 20, 10, 40, 31, 21, 11, 41, 70, 60, 50, 80, 71, 61, 51, 81,
				]);
			},
		);
	});

	it("stands the places of a bitmap of three places a colour in a picture of four", async () => {
		const tile = writeBmp24(2, 1, Buffer.from([10, 20, 30, 40, 50, 60]));
		const descriptor = dziFile(["2,1", "1", "1,1", "a.bmp"]);
		await withTiles(descriptor, { "a.bmp": tile }, async (mainPath) => {
			const { image } = await pictureOf(mainPath);
			expect(image.width).toBe(2);
			expect(image.height).toBe(1);
			// A place of a colour of the picture of the walk stands of an alpha of the picture behind it.
			expect([...image.pixels]).toEqual([10, 20, 30, 255, 40, 50, 60, 255]);
		});
	});

	it("stands of the tiles of the descriptor and of no other picture", async () => {
		const descriptor = dziFile(["2,1", "1", "1,1", "a.jpg"]);
		await withTiles(
			descriptor,
			{ "a.jpg": Buffer.from([1, 2, 3, 4]) },
			async (mainPath) => {
				const source = await FileByteSource.open(mainPath);
				// The descriptor stands of this engine, and the tile of it stands of a kind this project reads
				// no further than the reference reads its own list of them.
				expect(await dziImageFormat.detect(source, mainPath)).toBe(true);
				const archive = await dziImageFormat.open(source, mainPath);
				try {
					const entry = archive.entries[0];
					if (!entry) throw new Error("no entry");
					await expect(archive.openEntry(entry.id)).rejects.toMatchObject({
						code: "UNSUPPORTED_FEATURE",
					});
				} finally {
					await archive.close();
				}
			},
		);
		// A descriptor whose tiles stand nowhere is no picture of this engine, and neither is a file that
		// stands of no line of them at all.
		const root = await mkdtemp(join(tmpdir(), "dzi-"));
		try {
			const bare = join(root, "bare.dzi");
			await writeFile(bare, descriptor);
			const source = await FileByteSource.open(bare);
			expect(await dziImageFormat.detect(source, bare)).toBe(false);
			await expect(dziImageFormat.open(source, bare)).rejects.toThrow();
			const short = join(root, "short.dzi");
			await writeFile(short, dziFile(["2,1", "1", "1,1"]));
			const shortSource = await FileByteSource.open(short);
			expect(await dziImageFormat.detect(shortSource, short)).toBe(false);
		} finally {
			await rm(root, { recursive: true, force: true });
		}
	});
});
