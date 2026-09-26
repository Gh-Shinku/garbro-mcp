import { buffer as consumeBuffer } from "node:stream/consumers";
import { deflateSync } from "node:zlib";
import { crc32 } from "@garbro-mcp/codecs";
import { BufferByteSource, GarbroError } from "@garbro-mcp/core";
import { gameresPngImageFormat } from "@garbro-mcp/formats";
import { describe, expect, it } from "vitest";
import {
	readPngHeaderFields,
	PNG_SIGNATURE,
} from "../../packages/formats/src/shared/png.js";
import { readPngOffsets } from "../../packages/formats/src/gameres/png-image.js";
import { readBmpImage } from "../../packages/formats/src/shared/bmp.js";
import {
	interlacedRows,
	pngFile as interlacedPngFile,
} from "../helpers/png.js";

/** A chunk of a portable network graphic, of the count of its places and the words of it. */
function chunk(kind: string, body: Buffer): Buffer {
	const length: Buffer = Buffer.alloc(4, 0x00);
	length.writeUInt32BE(body.length, 0);
	const named = Buffer.concat([Buffer.from(kind, "latin1"), body]);
	const crc: Buffer = Buffer.alloc(4, 0x00);
	crc.writeUInt32BE(crc32(named), 0);
	return Buffer.concat([length, named, crc]);
}

/** A portable network graphic of the places of the file. */
function pngFile(input: {
	width: number;
	height: number;
	depth?: number;
	colourType?: number;
	rows: Buffer[];
	palette?: Buffer;
	offsets?: { x: number; y: number; unit?: number };
	interlace?: number;
}): Buffer {
	const head: Buffer = Buffer.alloc(13, 0x00);
	head.writeUInt32BE(input.width, 0);
	head.writeUInt32BE(input.height, 4);
	head[8] = input.depth ?? 8;
	head[9] = input.colourType ?? 2;
	head[12] = input.interlace ?? 0;
	const parts: Buffer[] = [PNG_SIGNATURE, chunk("IHDR", head)];
	if (input.offsets) {
		const offsets: Buffer = Buffer.alloc(9, 0x00);
		offsets.writeInt32BE(input.offsets.x, 0);
		offsets.writeInt32BE(input.offsets.y, 4);
		offsets[8] = input.offsets.unit ?? 0;
		parts.push(chunk("oFFs", offsets));
	}
	if (input.palette) parts.push(chunk("PLTE", input.palette));
	// A picture the test asks to be interlaced holds the seven walks of Adam7, and the rows of it stand
	// without the place of the filter their own walk puts in front of them.
	const body =
		1 === (input.interlace ?? 0)
			? Buffer.concat(
					interlacedRows({
						width: input.width,
						height: input.height,
						colourType: input.colourType ?? 2,
						depth: input.depth ?? 8,
						rows: input.rows.map((row) => [...row.subarray(1)]),
					}),
				)
			: Buffer.concat(input.rows);
	parts.push(chunk("IDAT", deflateSync(body)));
	parts.push(chunk("IEND", Buffer.alloc(0)));
	return Buffer.concat(parts);
}

/** The places of a row of a picture of three places to a place, of the places of the file. */
function rgbRow(places: number[][]): Buffer {
	const row: Buffer = Buffer.alloc(1 + places.length * 3, 0x00);
	places.forEach((place, at) => {
		row[1 + at * 3] = place[0] ?? 0;
		row[1 + at * 3 + 1] = place[1] ?? 0;
		row[1 + at * 3 + 2] = place[2] ?? 0;
	});
	return row;
}

async function pictureOf(data: Buffer) {
	const handle = await gameresPngImageFormat.open(
		new BufferByteSource(data),
		"cg.png",
	);
	const entry = handle.entries[0];
	if (!entry) throw new Error("no entry");
	const image = readBmpImage(
		await consumeBuffer(await handle.openEntry(entry.id)),
	);
	if (!image) throw new Error("the port handed over no picture");
	return image;
}

describe("Portable Network Graphics image", () => {
	it("reads the head of a picture", () => {
		const fields = readPngHeaderFields(
			pngFile({
				width: 2,
				height: 3,
				rows: [
					rgbRow([
						[1, 2, 3],
						[4, 5, 6],
					]),
				],
			}),
		);
		expect(fields).toEqual({ width: 2, height: 3, bitsPerPixel: 24 });
		// A picture of one place to a place, of two, of four and of sixteen stands of that count; a
		// picture of a colour map of its own stands of twenty four places.
		const grey = pngFile({
			width: 1,
			height: 1,
			colourType: 0,
			rows: [Buffer.from([0, 5])],
		});
		expect(readPngHeaderFields(grey)?.bitsPerPixel).toBe(8);
		const sixteen = pngFile({
			width: 1,
			height: 1,
			depth: 16,
			rows: [Buffer.from([0, 0, 0, 0, 0, 0, 0])],
		});
		expect(readPngHeaderFields(sixteen)?.bitsPerPixel).toBe(48);
		const mapped = pngFile({
			width: 1,
			height: 1,
			colourType: 3,
			palette: Buffer.from([1, 2, 3]),
			rows: [Buffer.from([0, 0])],
		});
		expect(readPngHeaderFields(mapped)?.bitsPerPixel).toBe(24);
		// A picture of no head of its own, of a depth it knows none of and of a colour it knows none of.
		expect(readPngHeaderFields(Buffer.alloc(0x20, 0x00))).toBeUndefined();
		const wrongDepth = pngFile({
			width: 1,
			height: 1,
			depth: 3,
			rows: [Buffer.alloc(2)],
		});
		expect(readPngHeaderFields(wrongDepth)).toBeUndefined();
		const wrongColour = pngFile({
			width: 1,
			height: 1,
			colourType: 5,
			rows: [Buffer.alloc(2)],
		});
		expect(readPngHeaderFields(wrongColour)).toBeUndefined();
	});

	it("reads the place of the picture in the picture of the places of it", () => {
		const offsets = readPngOffsets(
			pngFile({
				width: 1,
				height: 1,
				rows: [rgbRow([[1, 2, 3]])],
				offsets: { x: 7, y: 9 },
			}),
		);
		expect(offsets).toEqual({ x: 7, y: 9 });
		// A picture of no place of its own stands of no place of the picture.
		expect(
			readPngOffsets(
				pngFile({
					width: 1,
					height: 1,
					rows: [rgbRow([[1, 2, 3]])],
					offsets: { x: 7, y: 9, unit: 1 },
				}),
			),
		).toBeUndefined();
	});

	it("hands the places of a picture over as a bitmap", async () => {
		const image = await pictureOf(
			pngFile({
				width: 2,
				height: 1,
				rows: [
					rgbRow([
						[1, 2, 3],
						[4, 5, 6],
					]),
				],
			}),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([3, 2, 1, 6, 5, 4]);
		const alpha = await pictureOf(
			pngFile({
				width: 2,
				height: 1,
				colourType: 6,
				rows: [Buffer.from([0, 1, 2, 3, 4, 5, 6, 7, 8])],
			}),
		);
		expect(alpha.bitsPerPixel).toBe(32);
		expect([...alpha.pixels]).toEqual([3, 2, 1, 4, 7, 6, 5, 8]);
	});

	it("reads a picture of the places of a colour map of its own", async () => {
		const image = await pictureOf(
			pngFile({
				width: 2,
				height: 1,
				colourType: 3,
				palette: Buffer.from([10, 20, 30, 40, 50, 60]),
				rows: [Buffer.from([0, 0, 1])],
			}),
		);
		expect(image.bitsPerPixel).toBe(24);
		expect([...image.pixels]).toEqual([30, 20, 10, 60, 50, 40]);
	});

	it("reads an interlaced picture, whose places stand of seven walks", async () => {
		// Four places square, so that every walk of the interlace carries places of its own: the first walk
		// carries one place, the second none, the third none, the fourth one, the fifth two, the sixth four
		// and the seventh eight. The places of the picture are the places the fixture names.
		const places = [
			[
				[1, 2, 3],
				[4, 5, 6],
				[7, 8, 9],
				[10, 11, 12],
			],
			[
				[13, 14, 15],
				[16, 17, 18],
				[19, 20, 21],
				[22, 23, 24],
			],
			[
				[25, 26, 27],
				[28, 29, 30],
				[31, 32, 33],
				[34, 35, 36],
			],
			[
				[37, 38, 39],
				[40, 41, 42],
				[43, 44, 45],
				[46, 47, 48],
			],
		];
		const image = await pictureOf(
			interlacedPngFile({
				width: 4,
				height: 4,
				colourType: 2,
				interlace: 1,
				rows: places.map((row) => row.flat()),
			}),
		);
		expect(image).toMatchObject({ width: 4, height: 4, bitsPerPixel: 24 });
		expect([...image.pixels]).toEqual(
			places
				.flat()
				.flatMap((place) => [place[2] ?? 0, place[1] ?? 0, place[0] ?? 0]),
		);
	});

	it("reads an interlaced picture of one place, whose one walk carries it", async () => {
		const image = await pictureOf(
			pngFile({
				width: 1,
				height: 1,
				interlace: 1,
				rows: [rgbRow([[1, 2, 3]])],
			}),
		);
		expect([...image.pixels]).toEqual([3, 2, 1]);
	});

	it("tells a picture by the head of it", async () => {
		const data = pngFile({
			width: 1,
			height: 1,
			rows: [rgbRow([[1, 2, 3]])],
		});
		expect(
			await gameresPngImageFormat.detect?.(new BufferByteSource(data)),
		).toBe(true);
		expect(
			await gameresPngImageFormat.detect?.(
				new BufferByteSource(Buffer.alloc(0x20, 0x00)),
			),
		).toBe(false);
		await expect(
			gameresPngImageFormat.open(
				new BufferByteSource(Buffer.alloc(0x20, 0x00)),
				"cg.png",
			),
		).rejects.toThrow(GarbroError);
	});
});
