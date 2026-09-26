import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { GarbroError } from "@garbro-mcp/core";
import { crc32 } from "@garbro-mcp/codecs";
import { describe, expect, it } from "vitest";
import { readPngImage } from "../../packages/formats/src/shared/png-image.js";

const SIGNATURE: Buffer = Buffer.from([
	0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
]);

function chunk(type: string, body: Buffer): Buffer {
	const tag = Buffer.from(type, "latin1");
	const length: Buffer = Buffer.alloc(4);
	length.writeUInt32BE(body.length);
	const word: Buffer = Buffer.alloc(4);
	word.writeUInt32BE(crc32(Buffer.concat([tag, body])) >>> 0);
	return Buffer.concat([length, tag, body, word]);
}

interface Parts {
	width: number;
	height: number;
	depth: number;
	colour: number;
	/** The places of every row of the picture, of the control place of the row in front of them. */
	rows: Buffer[];
	palette?: Buffer;
	interlace?: number;
}

function pngFile(parts: Parts): Buffer {
	const head: Buffer = Buffer.alloc(13, 0x00);
	head.writeUInt32BE(parts.width, 0);
	head.writeUInt32BE(parts.height, 4);
	head[8] = parts.depth;
	head[9] = parts.colour;
	head[12] = parts.interlace ?? 0;
	const body: Buffer[] = [SIGNATURE, chunk("IHDR", head)];
	if (parts.palette) body.push(chunk("PLTE", parts.palette));
	body.push(chunk("IDAT", deflateSync(Buffer.concat(parts.rows))));
	body.push(chunk("IEND", Buffer.alloc(0)));
	return Buffer.concat(body);
}

/** A row of a picture of places as they stand, of the control place of the kind of filter it stands of. */
function row(filter: number, places: number[]): Buffer {
	return Buffer.concat([Buffer.from([filter]), Buffer.from(places)]);
}

describe("PNG picture reader", () => {
	it("reads a picture of every kind of places", async () => {
		// Grey places standing of one, two, four and eight of them, every place of the picture standing of
		// the greys its own places name.
		const grey8 = await readPngImage(
			pngFile({
				width: 2,
				height: 1,
				depth: 8,
				colour: 0,
				rows: [row(0, [0x10, 0x20])],
			}),
		);
		expect(grey8?.bitsPerPixel).toBe(24);
		expect([...((grey8?.pixels ?? Buffer.alloc(0)) as Buffer)]).toEqual([
			0x10, 0x10, 0x10, 0x20, 0x20, 0x20,
		]);
		const grey1 = await readPngImage(
			pngFile({
				width: 4,
				height: 1,
				depth: 1,
				colour: 0,
				rows: [row(0, [0b01010000])],
			}),
		);
		expect([...(grey1?.pixels ?? Buffer.alloc(0))]).toEqual([
			0x00, 0x00, 0x00, 0xff, 0xff, 0xff, 0x00, 0x00, 0x00, 0xff, 0xff, 0xff,
		]);
		const grey2 = await readPngImage(
			pngFile({
				width: 2,
				height: 1,
				depth: 2,
				colour: 0,
				rows: [row(0, [0b00011011])],
			}),
		);
		expect([...(grey2?.pixels ?? Buffer.alloc(0))]).toEqual([
			0x00, 0x00, 0x00, 0x55, 0x55, 0x55,
		]);
		// Places of three and of four colours stand of the colours as they stand, and a place of a picture
		// standing of four places of eight takes the higher of them.
		const rgb = await readPngImage(
			pngFile({
				width: 1,
				height: 1,
				depth: 8,
				colour: 2,
				rows: [row(0, [0x11, 0x22, 0x33])],
			}),
		);
		expect([...(rgb?.pixels ?? Buffer.alloc(0))]).toEqual([0x33, 0x22, 0x11]);
		const rgba = await readPngImage(
			pngFile({
				width: 1,
				height: 1,
				depth: 8,
				colour: 6,
				rows: [row(0, [0x11, 0x22, 0x33, 0x80])],
			}),
		);
		expect(rgba?.bitsPerPixel).toBe(32);
		expect([...(rgba?.pixels ?? Buffer.alloc(0))]).toEqual([
			0x33, 0x22, 0x11, 0x80,
		]);
		const deep = await readPngImage(
			pngFile({
				width: 1,
				height: 1,
				depth: 16,
				colour: 2,
				rows: [row(0, [0x11, 0xff, 0x22, 0xfe, 0x33, 0xfd])],
			}),
		);
		expect([...(deep?.pixels ?? Buffer.alloc(0))]).toEqual([0x33, 0x22, 0x11]);
		// A picture standing of a colour map names its places of the colours of the map.
		const mapped = await readPngImage(
			pngFile({
				width: 2,
				height: 1,
				depth: 4,
				colour: 3,
				palette: Buffer.from([1, 2, 3, 4, 5, 6]),
				rows: [row(0, [0x10])],
			}),
		);
		// The first place of a picture of four places to a byte stands in the higher half of it, and the
		// colours of a picture stand of the places of the file, of the blue of a colour first.
		expect([...(mapped?.pixels ?? Buffer.alloc(0))]).toEqual([
			6, 5, 4, 3, 2, 1,
		]);
		// A picture of greys standing of an alpha of its own stands of four places to a place.
		const greyAlpha = await readPngImage(
			pngFile({
				width: 1,
				height: 1,
				depth: 8,
				colour: 4,
				rows: [row(0, [0x44, 0x80])],
			}),
		);
		expect(greyAlpha?.bitsPerPixel).toBe(32);
		expect([...(greyAlpha?.pixels ?? Buffer.alloc(0))]).toEqual([
			0x44, 0x44, 0x44, 0x80,
		]);
	});

	it("puts the places of every row together of the row before it", async () => {
		// Every kind of filter stands of the places of its own row and of the row before it: nothing, the
		// place before, the place above, both of them, and the one of the three that stands nearest.
		const filters = await readPngImage(
			pngFile({
				width: 2,
				height: 5,
				depth: 8,
				colour: 0,
				rows: [
					row(0, [0x10, 0x20]),
					row(1, [0x10, 0x10]),
					row(2, [0x20, 0x20]),
					row(3, [0x08, 0x08]),
					row(4, [0x08, 0x08]),
				],
			}),
		);
		const rows: number[][] = [];
		for (let at = 0; at < 5; at += 1) {
			rows.push([...(filters?.pixels.subarray(at * 6, at * 6 + 6) ?? [])]);
		}
		expect(rows).toEqual([
			[0x10, 0x10, 0x10, 0x20, 0x20, 0x20],
			[0x10, 0x10, 0x10, 0x20, 0x20, 0x20],
			[0x30, 0x30, 0x30, 0x40, 0x40, 0x40],
			[0x20, 0x20, 0x20, 0x38, 0x38, 0x38],
			[0x28, 0x28, 0x28, 0x40, 0x40, 0x40],
		]);
	});

	it("turns away a picture that stands of no picture at all", async () => {
		const good = pngFile({
			width: 1,
			height: 1,
			depth: 8,
			colour: 0,
			rows: [row(0, [0x10])],
		});
		// A word of a chunk that stands of another picture, a file standing short of its own places, and a
		// file that stands of no PNG picture.
		const wrongWord = Buffer.from(good);
		wrongWord[wrongWord.length - 5] =
			(wrongWord[wrongWord.length - 5] ?? 0) ^ 0x5a;
		await expect(readPngImage(wrongWord)).rejects.toThrow(GarbroError);
		// A picture of one place stands of one walk, whether its head names an interlace or not.
		const interlaced = await readPngImage(
			pngFile({
				width: 1,
				height: 1,
				depth: 8,
				colour: 0,
				rows: [row(0, [0x10])],
				interlace: 1,
			}),
		);
		if (!interlaced) throw new Error("the port handed over no picture");
		expect(interlaced).toMatchObject({ width: 1, height: 1 });
		expect([...interlaced.pixels]).toEqual([0x10, 0x10, 0x10]);
		await expect(
			readPngImage(
				Buffer.concat([
					SIGNATURE,
					chunk(
						"IHDR",
						(() => {
							const head: Buffer = Buffer.alloc(13, 0x00);
							head.writeUInt32BE(4, 0);
							head.writeUInt32BE(4, 4);
							head[8] = 8;
							head[9] = 0;
							return head;
						})(),
					),
					chunk("IDAT", deflateSync(Buffer.from([0x00, 0x01]))),
					chunk("IEND", Buffer.alloc(0)),
				]),
			),
		).rejects.toThrow(GarbroError);
		await expect(readPngImage(Buffer.alloc(0))).rejects.toThrow(GarbroError);
	});
});
