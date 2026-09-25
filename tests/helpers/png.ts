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

/** A portable network graphic of the rows of places a test asks for. */
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
	for (const row of input.rows) places.push(Buffer.from([0, ...row]));
	const parts: Buffer[] = [PNG_SIGNATURE, pngChunk("IHDR", head)];
	if (input.palette) parts.push(pngChunk("PLTE", input.palette));
	parts.push(pngChunk("IDAT", deflateSync(Buffer.concat(places))));
	parts.push(pngChunk("IEND", Buffer.alloc(0)));
	return Buffer.concat(parts);
}
