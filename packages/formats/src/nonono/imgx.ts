// Format reference: GARbro "ArcFormats/Nonono/ImageIMGX.cs", class `ImgXDecoder`, which the opener of the
// archives of this engine hands an entry to where the entry opens with the word `IMGX`.
// GARbro commit b09ee4570ccb1daf6ac56710ee8934dc0b8baeb0, MIT License.

import { LsbBitReader } from "@garbro-mcp/codecs";
import { writeBmp24, writeBmp32, writeBmp8Palette } from "../shared/bmp.js";

/** The word an entry of this kind opens with, which `IBinaryStream.Signature` reads the short way round. */
export const IMGX_SIGNATURE = 0x58474d49;
/** The places of the file of the tree of the walk, and the words it stands of. */
const TREE_SIZE = 0x88cf;
const FIRST_ROOT = 259;
const FIRST_CODE_LENGTH = 9;
const GROW_CODE = 257;
const END_CODE = 256;
const RESTART_CODE = 258;
/** The head of the picture the walk unfolds, and the places its own fields stand. */
const UNPACKED_HEAD_SIZE = 0x36;
const IMAGE_HEADER_SIZE_AT = 0;
const WIDTH_AT = 4;
const HEIGHT_AT = 8;
const BITS_PER_PIXEL_AT = 0x0e;
const COLOURS_AT = 0x20;
const COLOUR_BYTES = 4;
const DEFAULT_COLOURS = 0x100;
/** A picture this project is willing to hold. */
const LIMIT = 256 * 1024 * 1024;

/**
 * `ImgXDecoder`: the picture of an entry that opens with the word `IMGX`. Behind that word stands the
 * complement of the count of the places the picture unfolds to, with the two halves of the word the other way
 * round, and then a walk of the bits of the file from the eighth byte on: a walk of the counts of the places
 * of the file whose words grow longer as the walk goes, where the word 257 stands for that growth, the word
 * 256 for the end of the walk, and the word 258 for a new start. What unfolds is the head of a picture of
 * four places of the file and the places of the picture behind it, which this walk hands out as a bitmap.
 */
export function unpackImgx(data: Buffer): Buffer | undefined {
	if (data.length <= 8) return undefined;
	if (IMGX_SIGNATURE !== data.readUInt32LE(0)) return undefined;
	const complement = ~data.readUInt32LE(4) >>> 0;
	const unpackedSize = ((complement >> 16) | (complement << 16)) >>> 0;
	if (unpackedSize > LIMIT || unpackedSize < UNPACKED_HEAD_SIZE)
		return undefined;
	const output = unpackImgxWalk(data, unpackedSize);
	return imgxBitmap(output);
}

/** `ImgXDecoder.Unpack`: the walk of the counts of the places of the file. */
function unpackImgxWalk(data: Buffer, unpackedSize: number): Buffer {
	const bits = new LsbBitReader(data, 8);
	const output: Buffer = Buffer.alloc(unpackedSize, 0x00);
	const child = new Int32Array(TREE_SIZE);
	const value = new Uint8Array(TREE_SIZE);
	const buffer: Buffer = Buffer.alloc(TREE_SIZE, 0x00);
	let out = 0;
	let rootNode = FIRST_ROOT;
	let codeLength = FIRST_CODE_LENGTH;
	let lastCode = bits.tryReadBits(codeLength);
	if (-1 === lastCode || END_CODE === lastCode) return output;
	let lastSymbol = lastCode & 0xff;
	output[out++] = lastSymbol;
	while (out < output.length) {
		let code: number;
		for (;;) {
			code = bits.tryReadBits(codeLength);
			if (-1 === code) return output;
			if (GROW_CODE !== code) break;
			codeLength += 1;
		}
		if (END_CODE === code) break;
		if (RESTART_CODE === code) {
			rootNode = FIRST_ROOT;
			codeLength = FIRST_CODE_LENGTH;
			lastCode = bits.tryReadBits(codeLength);
			if (-1 === lastCode || END_CODE === lastCode) return output;
			lastSymbol = lastCode & 0xff;
			output[out++] = lastSymbol;
			continue;
		}
		let symbol = code;
		let place = 0;
		if (code >= rootNode) {
			symbol = lastCode;
			buffer[place++] = lastSymbol;
		}
		while (symbol > 0xff) {
			if (place >= buffer.length) return output;
			buffer[place++] = value[symbol] ?? 0;
			symbol = child[symbol] ?? 0;
		}
		lastSymbol = buffer[place] = symbol & 0xff;
		while (place >= 0) {
			if (out >= output.length) return output;
			output[out++] = buffer[place--] ?? 0;
		}
		child[rootNode] = lastCode;
		value[rootNode] = lastSymbol;
		rootNode += 1;
		lastCode = code;
	}
	return output;
}

/** `ImgXDecoder.GetImage`: the head the walk unfolded, and the places of the picture behind it. */
function imgxBitmap(unpacked: Buffer): Buffer | undefined {
	const headerSize = unpacked.readInt32LE(IMAGE_HEADER_SIZE_AT);
	const width = unpacked.readUInt32LE(WIDTH_AT);
	const height = unpacked.readUInt32LE(HEIGHT_AT);
	const bitsPerPixel = unpacked.readUInt16LE(BITS_PER_PIXEL_AT);
	if (0 === width || 0 === height) return undefined;
	if (headerSize < 0 || headerSize > unpacked.length) return undefined;
	const stride = Math.trunc((width * bitsPerPixel) / 8);
	const size = stride * height;
	if (size > LIMIT) return undefined;
	const body = unpacked.subarray(headerSize);
	if (8 === bitsPerPixel) {
		let colours = unpacked.readInt32LE(COLOURS_AT);
		if (0 === colours) colours = DEFAULT_COLOURS;
		if (colours < 0 || colours > DEFAULT_COLOURS) return undefined;
		const paletteSize = colours * COLOUR_BYTES;
		if (paletteSize + size > body.length) return undefined;
		return writeBmp8Palette(
			width,
			height,
			body.subarray(paletteSize, paletteSize + size),
			body.subarray(0, paletteSize),
		);
	}
	if (size > body.length) return undefined;
	const pixels = body.subarray(0, size);
	if (24 === bitsPerPixel) return writeBmp24(width, height, pixels);
	if (32 === bitsPerPixel) return writeBmp32(width, height, pixels);
	return undefined;
}
