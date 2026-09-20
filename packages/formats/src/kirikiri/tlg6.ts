import { Buffer } from "node:buffer";
import { decodeTlg6GolombValues } from "@garbro-mcp/codecs";
import { applyTlg6Line } from "@garbro-mcp/codecs";
import {
	decompressSlide,
	invalidPicture,
	type TlgLayout,
} from "./tlg-image.js";

const H_BLOCK = 8;
const W_BLOCK = 8;
const RING_SIZE = 4096;
const GOLOMB_METHOD = 0;
const MOST_WORDS = 4;
const POOL_SLACK = 5 + 10;

function seedLzssText(): Buffer {
	const text = Buffer.alloc(RING_SIZE);
	let at = 0;
	for (let i = 0; i < 32; i += 1) {
		for (let j = 0; j < 16; j += 1) {
			text[at] = i;
			text[at + 1] = i;
			text[at + 2] = i;
			text[at + 3] = i;
			text[at + 4] = j;
			text[at + 5] = j;
			text[at + 6] = j;
			text[at + 7] = j;
			at += 8;
		}
	}
	return text;
}

export function unpackTlg6(data: Buffer, layout: TlgLayout): Buffer {
	if (layout.version !== 6)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture stand of the places of the picture of the walk of the places of the picture of the fifth kind of the places of the picture of the walk of the places of the picture of the sound of the engine that stand outside the places of the picture of the walk of the places of the picture of the picture",
		);
	const width = layout.width;
	const height = layout.height;
	const colors = layout.colors;
	if (layout.dataOffset + MOST_WORDS > data.length)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
		);
	let at = layout.dataOffset;
	const maxBitLength = data.readInt32LE(at);
	at += MOST_WORDS;
	if (maxBitLength < 0)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand of the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture of the kind of the places of the picture of the walk of the places of the picture of their own",
		);
	const xBlockCount = Math.floor((width - 1) / W_BLOCK) + 1;
	const yBlockCount = Math.floor((height - 1) / H_BLOCK) + 1;
	const mainCount = Math.floor(width / W_BLOCK);
	const fraction = width - mainCount * W_BLOCK;
	const imageBits = new Uint32Array(height * width);
	const poolBytes = (maxBitLength >> 3) + POOL_SLACK;
	const pixelbuf = new Uint32Array(width * H_BLOCK + 1);
	const filterTypes = Buffer.alloc(xBlockCount * yBlockCount);
	const zeroline = new Uint32Array(width);
	const zerocolor = colors === 3 ? 0xff000000 : 0;
	zeroline.fill(zerocolor >>> 0);
	const lzssText = seedLzssText();
	if (at + MOST_WORDS > data.length)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
		);
	const inbufSize = data.readInt32LE(at);
	at += MOST_WORDS;
	if (inbufSize < 0 || at + inbufSize > data.length)
		throw invalidPicture(
			"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
		);
	decompressSlide(
		filterTypes,
		data.subarray(at, at + inbufSize),
		inbufSize,
		lzssText,
		0,
	);
	at += inbufSize;
	let prevLine = zeroline;
	let prevAt = 0;
	for (let y = 0; y < height; y += H_BLOCK) {
		let ylim = y + H_BLOCK;
		if (ylim >= height) ylim = height;
		const pixelCount = (ylim - y) * width;
		for (let c = 0; c < colors; c += 1) {
			if (at + MOST_WORDS > data.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			let bitLength = data.readInt32LE(at);
			at += MOST_WORDS;
			const method = (bitLength >> 30) & 3;
			bitLength &= 0x3fffffff;
			let byteLength = bitLength >> 3;
			if (bitLength % 8 !== 0) byteLength += 1;
			if (at + byteLength > data.length)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture stand short of the places of the picture",
				);
			if (method !== GOLOMB_METHOD)
				throw invalidPicture("Unsupported entropy coding method");
			if (byteLength > poolBytes)
				throw invalidPicture(
					"The places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of the places of the picture stand past the places of the picture of the walk of the places of the picture of the words of the walk of the picture",
				);
			const payload = data.subarray(at, at + byteLength);
			try {
				if (c === 0 && colors !== 1)
					decodeTlg6GolombValues(pixelbuf, 0, pixelCount, payload, true);
				else
					decodeTlg6GolombValues(pixelbuf, c * 8, pixelCount, payload, false);
			} catch (error) {
				if (error instanceof RangeError)
					throw invalidPicture(
						"The places of the picture of the walk of the places of the picture of the words of the walk of the picture stand shorter than the places of the picture of the walk of the places of the picture of the sound of the places of the picture of the walk of them",
					);
				throw error;
			}
			at += byteLength;
		}
		const ft = Math.floor(y / H_BLOCK) * xBlockCount;
		const skipbytes = (ylim - y) * W_BLOCK;
		for (let yy = y; yy < ylim; yy += 1) {
			const curline = yy * width;
			const dir = (yy & 1) ^ 1;
			const oddskip = ylim - yy - 1 - (yy - y);
			if (mainCount !== 0) {
				const start = Math.min(width, W_BLOCK) * (yy - y);
				applyTlg6Line(
					prevLine,
					prevAt,
					imageBits,
					curline,
					width,
					0,
					mainCount,
					filterTypes,
					ft,
					skipbytes,
					pixelbuf,
					start,
					zerocolor,
					oddskip,
					dir,
				);
			}
			if (mainCount !== xBlockCount) {
				let ww = fraction;
				if (ww > W_BLOCK) ww = W_BLOCK;
				const start = ww * (yy - y);
				applyTlg6Line(
					prevLine,
					prevAt,
					imageBits,
					curline,
					width,
					mainCount,
					xBlockCount,
					filterTypes,
					ft,
					skipbytes,
					pixelbuf,
					start,
					zerocolor,
					oddskip,
					dir,
				);
			}
			prevLine = imageBits;
			prevAt = curline;
		}
	}
	const pixels = Buffer.alloc(height * width * 4);
	for (let i = 0; i < imageBits.length; i += 1)
		pixels.writeUInt32LE(imageBits[i] ?? 0, i * 4);
	return pixels;
}
