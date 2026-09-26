// A writer of portable network graphics for the fixtures of the formats whose streams are graphics of that
// kind: the chunks of a file written by hand, of the places a test asks for and of no walk of its own.
import { Buffer } from "node:buffer";
import { deflateSync } from "node:zlib";
import { crc32 } from "@garbro-mcp/codecs";
import { PNG_SIGNATURE } from "../../packages/formats/src/shared/png.js";

/** One chunk of a portable network graphic: its count, its kind, the places of it and its own word. */
export function pngChunk(kind: string, body: Buffer): Buffer {
	const length = Buffer.alloc(4, 0);
	length.writeUInt32BE(body.length, 0);
	const named = Buffer.concat([Buffer.from(kind, "latin1"), body]);
	const crc = Buffer.alloc(4, 0);
	crc.writeUInt32BE(crc32(named), 0);
	return Buffer.concat([length, named, crc]);
}

/** The places of a place of a pixel of every kind of a picture, which the seven walks step over. */
const PIXEL_CHANNELS = new Map([
	[0, 1],
	[2, 3],
	[3, 1],
	[4, 2],
	[6, 4],
]);

/** The seven walks of an interlaced picture: the first column and row of each and the distances behind them. */
const INTERLACE_PASSES = [
	[0, 0, 8, 8],
	[4, 0, 8, 8],
	[0, 4, 4, 8],
	[2, 0, 4, 4],
	[0, 2, 2, 4],
	[1, 0, 2, 2],
	[0, 1, 1, 2],
] as const;

/**
 * A portable network graphic of the rows of places a test asks for. A picture the test asks to be interlaced
 * holds the places of its seven walks, each walk carrying the places of every eighth, fourth or second row
 * and column of it, with every walk in its own rows of places behind a kind of filter of its own.
 */
export function pngFile(input: {
	width: number;
	height: number;
	colourType: number;
	depth?: number;
	rows: readonly (readonly number[])[];
	palette?: Buffer;
	interlace?: number;
}): Buffer {
	const head = Buffer.alloc(13, 0);
	head.writeUInt32BE(input.width, 0);
	head.writeUInt32BE(input.height, 4);
	head[8] = input.depth ?? 8;
	head[9] = input.colourType;
	head[12] = input.interlace ?? 0;
	const places: Buffer[] = [];
	const depth = input.depth ?? 8;
	const placesOfPixel = Math.max(
		1,
		Math.ceil(((PIXEL_CHANNELS.get(input.colourType) ?? 1) * depth) / 8),
	);
	if (1 === (input.interlace ?? 0)) {
		for (const [
			firstColumn,
			firstRow,
			columnStep,
			rowStep,
		] of INTERLACE_PASSES) {
			// A walk whose first column or first row stands behind the picture carries nothing at all.
			if (input.width <= firstColumn || input.height <= firstRow) continue;
			for (let y = firstRow; y < input.height; y += rowStep) {
				const row = input.rows[y] ?? [];
				const walk: number[] = [];
				for (let x = firstColumn; x < input.width; x += columnStep) {
					for (let at = 0; at < placesOfPixel; at += 1) {
						walk.push(row[x * placesOfPixel + at] ?? 0);
					}
				}
				places.push(Buffer.from([0, ...walk]));
			}
		}
	} else {
		for (const row of input.rows) places.push(Buffer.from([0, ...row]));
	}
	const parts: Buffer[] = [PNG_SIGNATURE, pngChunk("IHDR", head)];
	if (input.palette) parts.push(pngChunk("PLTE", input.palette));
	parts.push(pngChunk("IDAT", deflateSync(Buffer.concat(places))));
	parts.push(pngChunk("IEND", Buffer.alloc(0)));
	return Buffer.concat(parts);
}
