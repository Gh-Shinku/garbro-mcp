import { Buffer } from "node:buffer";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { crc32 } from "@garbro-mcp/codecs";
import { iptImageFormat } from "@garbro-mcp/formats";
import { afterAll, describe, expect, it } from "vitest";
import {
	parseIpt,
	readIptLayout,
} from "../../packages/formats/src/artemis/ipt-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";

const PNG_SIGNATURE: Buffer = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);
const directories: string[] = [];

afterAll(async () => {
	for (const directory of directories) {
		await rm(directory, { recursive: true, force: true });
	}
});

function chunk(type: string, body: Buffer): Buffer {
	const tag = Buffer.from(type, "latin1");
	const length: Buffer = Buffer.alloc(4);
	length.writeUInt32BE(body.length);
	const word: Buffer = Buffer.alloc(4);
	word.writeUInt32BE(crc32(Buffer.concat([tag, body])) >>> 0);
	return Buffer.concat([length, tag, body, word]);
}

/**
 * A picture of the kind the places of a composite picture stand of, of the places of the canvas it stands
 * on: the places of a colour of every place stand blue, green, red, of the alpha behind them where the
 * picture stands of one.
 */
function pngFile(
	width: number,
	height: number,
	places: number[][],
	alpha: boolean,
): Buffer {
	const placeSize = alpha ? 4 : 3;
	const head: Buffer = Buffer.alloc(13, 0x00);
	head.writeUInt32BE(width, 0);
	head.writeUInt32BE(height, 4);
	head[8] = 8;
	head[9] = alpha ? 6 : 2;
	const rows: Buffer[] = [];
	for (let row = 0; row < height; row += 1) {
		const line: Buffer = Buffer.alloc(1 + width * placeSize, 0x00);
		for (let column = 0; column < width; column += 1) {
			const place = places[row * width + column] ?? [];
			const at = 1 + column * placeSize;
			line[at] = place[2] ?? 0;
			line[at + 1] = place[1] ?? 0;
			line[at + 2] = place[0] ?? 0;
			if (alpha) line[at + 3] = place[3] ?? 0;
		}
		rows.push(line);
	}
	return Buffer.concat([
		PNG_SIGNATURE,
		chunk("IHDR", head),
		chunk("IDAT", deflateSync(Buffer.concat(rows))),
		chunk("IEND", Buffer.alloc(0)),
	]);
}

/** The places of a picture of a place of one colour, standing as many times as the picture holds places. */
function placesOf(count: number, place: number[]): number[][] {
	const places: number[][] = [];
	for (let at = 0; at < count; at += 1) places.push([...place]);
	return places;
}

/** A directory holding a composite picture and the pictures it stands on. */
async function directoryWith(
	descriptor: string,
	tiles: Record<string, Buffer>,
): Promise<string> {
	const directory = await mkdtemp(join(tmpdir(), "ipt-"));
	directories.push(directory);
	await writeFile(join(directory, "cg.ipt"), descriptor, "latin1");
	for (const [name, data] of Object.entries(tiles)) {
		await writeFile(join(directory, `${name}.png`), data);
	}
	return join(directory, "cg.ipt");
}

async function pictureOf(path: string) {
	const descriptor: Buffer = Buffer.from(await readFile(path));
	const handle = await iptImageFormat.open(
		new BufferByteSource(descriptor),
		path,
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no bitmap");
	return image;
}

describe("Artemis composite picture", () => {
	it("reads the language a picture stands of", () => {
		const root = parseIpt(
			Buffer.from(
				'ipt = { mode = "cut" base = { w = 4 h = 2 x = 1 y = 2 "cg" } { id = 1 file = "a" x = 0 y = 0 } }',
				"latin1",
			),
		);
		expect(root?.fields.get("mode")).toBe("cut");
		expect(root?.values.length).toBe(1);
		// The words of a string keep the places behind their own backslash, which is the reading of the
		// reference, and the picture the file names stands under the word `ipt` alone.
		const escaped = parseIpt(Buffer.from('ipt = { "c:\\cg.png", }', "latin1"));
		expect(escaped?.values[0]).toBe("c:\\cg.png");
		expect(parseIpt(Buffer.from("root = { }", "latin1"))).toBeUndefined();
		expect(() => parseIpt(Buffer.from("ipt = { mode = ? }", "latin1"))).toThrow(
			GarbroError,
		);
	});

	it("reads the canvas of a picture and the places of it", () => {
		const layout = readIptLayout(
			Buffer.from(
				'ipt = { mode = "cut" base = { w = 4 h = 3 x = 1 y = 2 "cg" } { id = 7 file = "a" x = 1 y = 2 } { id = 8 file = "b" x = 0 y = 0 } }',
				"latin1",
			),
		);
		expect(layout?.width).toBe(4);
		expect(layout?.height).toBe(3);
		expect(layout?.offsetX).toBe(1);
		expect(layout?.offsetY).toBe(2);
		expect(layout?.baseName).toBe("cg");
		expect(layout?.tiles.length).toBe(2);
		expect(layout?.tiles[0]).toEqual({ id: 7, fileName: "a", x: 1, y: 2 });
		// The kind of a picture of its own this engine does not know, a picture cut of no places, a canvas
		// standing of no places, and a picture standing of no place of its own at all.
		expect(() =>
			readIptLayout(
				Buffer.from(
					'ipt = { mode = "other" base = { w = 1 h = 1 x = 0 y = 0 "cg" } }',
					"latin1",
				),
			),
		).toThrow(/other/);
		expect(
			readIptLayout(
				Buffer.from(
					'ipt = { mode = "cut" base = { w = 1 h = 1 x = 0 y = 0 "cg" } }',
					"latin1",
				),
			),
		).toBeUndefined();
		expect(
			readIptLayout(
				Buffer.from('ipt = { mode = "diff" w = 1 h = 1 }', "latin1"),
			),
		).toBeUndefined();
		expect(
			readIptLayout(
				Buffer.from(
					'ipt = { mode = "diff" base = { w = 1 h = 1 x = 0 y = 0 } }',
					"latin1",
				),
			),
		).toBeUndefined();
	});

	it("draws the places of the pictures beside it over the canvas of the picture", async () => {
		// A picture of two places by two standing in the corner of a canvas of nine places, and a place of
		// another picture of two places by two standing over the corner of it.
		const under = pngFile(2, 2, placesOf(4, [0x10, 0x20, 0x30, 0xff]), true);
		const over = pngFile(2, 2, placesOf(4, [0x40, 0x50, 0x60, 0x80]), true);
		const path = await directoryWith(
			'ipt = { mode = "cut" base = { w = 3 h = 3 x = 0 y = 0 "cg" } { id = 1 file = "under" x = 0 y = 0 } { id = 2 file = "over" x = 1 y = 1 } }',
			{ cg: under, under, over },
		);
		const image = await pictureOf(path);
		expect(image.bitsPerPixel).toBe(32);
		expect(image.width).toBe(3);
		// The places of the picture standing over the canvas stand on the places of the picture behind them
		// where the alpha of them names it, and stand as they stand where it does not.
		const blend = (over1: number, under1: number): number =>
			Math.trunc((over1 * 0x80 + under1 * 0x7f) / 0xff);
		expect([...image.pixels]).toEqual([
			0x10,
			0x20,
			0x30,
			0xff,
			0x10,
			0x20,
			0x30,
			0xff,
			0x00,
			0x00,
			0x00,
			0x00,
			0x10,
			0x20,
			0x30,
			0xff,
			blend(0x40, 0x10),
			blend(0x50, 0x20),
			blend(0x60, 0x30),
			0x80,
			0x40,
			0x50,
			0x60,
			0x80,
			0x00,
			0x00,
			0x00,
			0x00,
			0x40,
			0x50,
			0x60,
			0x80,
			0x40,
			0x50,
			0x60,
			0x80,
		]);
	});

	it("stands the picture of the other kind on the picture beside it", async () => {
		const base = pngFile(2, 2, placesOf(4, [0x10, 0x20, 0x30, 0x40]), true);
		const tile = pngFile(1, 1, placesOf(1, [0x70, 0x80, 0x90, 0xff]), true);
		const path = await directoryWith(
			'ipt = { mode = "diff" base = { w = 2 h = 2 x = 0 y = 0 "cg" } { id = 1 file = "tile" x = 0 y = 0 } }',
			{ cg: base, tile },
		);
		const image = await pictureOf(path);
		// The places of the picture the canvas stands on stand as they stand - without the alpha the places
		// of their own carry, which the kind of this picture does not hold - and the place of the picture
		// beside it stands over the first place of the canvas.
		expect([...image.pixels]).toEqual([
			0x70, 0x80, 0x90, 0x00, 0x10, 0x20, 0x30, 0x00, 0x10, 0x20, 0x30, 0x00,
			0x10, 0x20, 0x30, 0x00,
		]);
	});

	it("keeps the places of a picture standing over the edge of the canvas", async () => {
		const tile = pngFile(2, 2, placesOf(4, [0x11, 0x22, 0x33, 0xff]), true);
		const path = await directoryWith(
			'ipt = { mode = "cut" base = { w = 2 h = 2 x = 0 y = 0 "cg" } { id = 1 file = "tile" x = 1 y = 1 } { id = 2 file = "far" x = 9 y = 9 } }',
			{ cg: tile, tile, far: tile },
		);
		const image = await pictureOf(path);
		// A picture cut of its own stands of the places of the pictures beside it alone: the place of the
		// picture standing over the corner of the canvas stands of the one place of it that stands over the
		// canvas, and the picture standing past the canvas stands of nothing at all.
		expect([...image.pixels]).toEqual([
			0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00,
			0x11, 0x22, 0x33, 0xff,
		]);
	});

	it("tells a picture by the words of its own and holds it to the pictures beside it", async () => {
		const tile = pngFile(2, 2, placesOf(4, [0x01, 0x02, 0x03, 0xff]), true);
		const path = await directoryWith(
			'ipt = { mode = "cut" base = { w = 2 h = 2 x = 0 y = 0 "cg" } { id = 1 file = "tile" x = 0 y = 0 } }',
			{ cg: tile, tile },
		);
		const descriptor: Buffer = Buffer.from(await readFile(path));
		expect(
			await iptImageFormat.detect?.(new BufferByteSource(descriptor)),
		).toBe(true);
		expect(
			await iptImageFormat.detect?.(
				new BufferByteSource(Buffer.from("ipt = {", "latin1")),
			),
		).toBe(false);
		// A picture standing of a name that reaches outside the directory of the picture that names it, and
		// one standing of a picture that stands of nothing.
		const outside = await directoryWith(
			'ipt = { mode = "cut" base = { w = 2 h = 2 x = 0 y = 0 "cg" } { id = 1 file = "../tile" x = 0 y = 0 } }',
			{ cg: tile, tile },
		);
		await expect(pictureOf(outside)).rejects.toThrow(GarbroError);
		const missing = await directoryWith(
			'ipt = { mode = "cut" base = { w = 2 h = 2 x = 0 y = 0 "cg" } { id = 1 file = "gone" x = 0 y = 0 } }',
			{ cg: tile, tile },
		);
		await expect(pictureOf(missing)).rejects.toThrow(/gone/);
	});
});
