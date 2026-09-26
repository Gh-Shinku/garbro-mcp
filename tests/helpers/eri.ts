// The places of a picture of the engine, of the tests of the port: the counts of the walk of the engine of
// a picture of the counts of the engine itself, of the counts of the walk of the engine of the encoder of
// the port (`tests/helpers/erisa.ts`).
import { ErisaHuffmanTree } from "@garbro-mcp/codecs";
import { ErisaEncoder, addSymbolBits, bitsToBuffer } from "./erisa.js";
import { Buffer } from "node:buffer";

/** The counts of the walk of the engine of a block of a picture of the engine, of no count of it. */
export const BLOCK = 8;
export const BLOCK_AREA = BLOCK * BLOCK;

/**
 * The places of the walk of the engine of a picture of the counts of the engine itself: the counts of the
 * walk of the places of the picture of the head of it (the count of the kind of the walk of it, the count
 * of the walk of the counts of a colour, the count of the kind of the walk of the engine and the count of
 * the places of a colour of it), the counts of the walk of the engine of every count of a block of the
 * picture one behind the other and then the places of the walk of the engine of the count of a block
 * itself.
 */
export function losslessFrame(input: {
	blocks: readonly (readonly number[])[];
	walkVersion?: number;
	opTable?: number;
	encodeType?: number;
	bitCount?: number;
	operations?: readonly number[];
	operationTree?: boolean;
}): Buffer {
	const bits: number[] = [];
	const word = (value: number, count: number): void => {
		for (let at = count - 1; at >= 0; at -= 1) bits.push((value >>> at) & 1);
	};
	word(input.walkVersion ?? 1, 8);
	word(input.opTable ?? 0, 8);
	word(input.encodeType ?? 0, 8);
	word(input.bitCount ?? 0, 8);
	// The counts of the walk of the engine of the places of a count of a block of the picture stand of the
	// counts of the walk of the engine of the tree of the counts of the walk of it of their own where the
	// picture stands of counts of a colour of its own of three places of them and up.
	const tree = input.operationTree ? new ErisaHuffmanTree() : undefined;
	if (tree) {
		for (const operation of input.operations ?? []) {
			addSymbolBits(bits, tree, operation & 0xff);
		}
	}
	bits.push(0);
	// The counts of the walk of the engine of the places of the picture stand of the counts of the walk of
	// the engine of every count of the block of the picture, one behind the other: the counts of the walk of
	// the engine of the count of the walk of the picture stand of the counts of the walk of the engine of
	// every count of the walk of it.
	const encoder = new ErisaEncoder();
	const operations = input.operationTree ? new ErisaHuffmanTree() : undefined;
	for (const block of input.blocks) {
		if (operations) {
			// The counts of the walk of the engine of the places of the count of the walk of the engine of
			// every count of a block stand of the counts of the walk of the engine of the count of the walk
			// of it, one behind the other.
			addSymbolBits(bits, operations, 0xc0);
		}
		const before = encoder.bits.length;
		encoder.addPlaces(block);
		bits.push(...encoder.bits.slice(before));
	}
	return bitsToBuffer(bits);
}

/** The places of the picture of the engine, of the counts of the walk of the engine of the picture. */
export function frameSection(places: Buffer): Buffer {
	const head = Buffer.alloc(0x10);
	head.write("ImageFrm".padEnd(8, " "), 0, "latin1");
	head.writeBigInt64LE(BigInt(places.length), 8);
	return Buffer.concat([head, places]);
}

/**
 * The places of the picture of the engine of the counts of the walk of the engine of the counts of it: every
 * place of the picture stands of the counts of the walk of the engine of every place of the count of the
 * walk of the engine of the picture in front of it, of the counts of the walk of the engine of the count of
 * the walk of the picture of its own (`PerformOperation`, of the counts of the walk of the engine of the
 * count of the walk of the engine of the count of the walk of it).
 */
export function countedPicture(
	blocks: readonly (readonly number[])[],
	width: number,
	height: number,
	channels: number,
): number[][] {
	const planes: number[][] = [];
	for (let channel = 0; channel < channels; channel += 1) {
		const plane: number[] = new Array(width * height).fill(0);
		for (const [at, block] of blocks.entries()) {
			const blockX = (at % (width / BLOCK)) * BLOCK;
			const blockY = Math.floor(at / (width / BLOCK)) * BLOCK;
			for (let y = 0; y < BLOCK; y += 1) {
				for (let x = 0; x < BLOCK; x += 1) {
					plane[(blockY + y) * width + blockX + x] =
						block[channel * BLOCK_AREA + y * BLOCK + x] ?? 0;
				}
			}
		}
		const counted: number[] = new Array(width * height).fill(0);
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const left = x > 0 ? (counted[y * width + x - 1] ?? 0) : 0;
				const up = y > 0 ? (counted[(y - 1) * width + x] ?? 0) : 0;
				const diagonal =
					x > 0 && y > 0 ? (counted[(y - 1) * width + x - 1] ?? 0) : 0;
				counted[y * width + x] =
					(left + up - diagonal + (plane[y * width + x] ?? 0)) & 0xff;
			}
		}
		planes.push(counted);
	}
	return planes;
}
